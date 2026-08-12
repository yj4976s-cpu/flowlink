from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.admin as admin_api
from app.core.security import hash_password
from app.db.session import Base, get_db
from app.main import app
from app.models import Camera, DetectedObject, DetectionEvent, FoundItem, LostReport, MatchCandidate, Notification, ObjectClass, ProcessingHistory, User, VideoJob
from app.services.matching import create_match_candidates_for_found_item, reconcile_match_candidates_for_found_item


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    with factory() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def seed_admin(db: Session) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    db.add(User(id=1, email="admin@example.com", password_hash=hash_password("password123"), nickname="admin", role="ADMIN", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now))
    db.commit()


def login(client: TestClient) -> None:
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "password123"}).status_code == 200


def seed_user(db: Session) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    db.add(User(id=2, email="user@example.com", password_hash=hash_password("password123"), nickname="user", role="USER", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now))
    db.commit()


def login_user(client: TestClient) -> None:
    assert client.post("/api/auth/login", json={"email": "user@example.com", "password": "password123"}).status_code == 200


def seed_detection(db: Session, *, object_id: int, event_id: int, detected_at: datetime, confidence: str = "0.8750", source_type: str = "IMAGE", include_crop: bool = True, admin_memo: str | None = None, purpose: str = "OPERATION") -> None:
    now = detected_at
    if db.get(ObjectClass, 1) is None:
        db.add(ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now))
    if db.get(Camera, 1) is None:
        db.add(Camera(id=1, code="CAM-1", name="테스트 카메라", area_name="잠실", is_active=True, created_at=now, updated_at=now))
    extension = "jpg" if source_type == "IMAGE" else "mp4"
    db.add(DetectionEvent(id=event_id, camera_id=1, purpose=purpose, source_type=source_type, original_media_url=f"/uploads/{event_id}.{extension}", result_media_url=None, status="COMPLETED", captured_at=detected_at, processing_started_at=detected_at, processing_completed_at=detected_at, created_at=now, updated_at=now))
    db.add(DetectedObject(id=object_id, detection_event_id=event_id, object_class_id=1, processing_status="CONFIRMED", confidence=Decimal(confidence), bbox_x=Decimal("1"), bbox_y=Decimal("2"), bbox_width=Decimal("30"), bbox_height=Decimal("40"), cropped_image_url=f"/uploads/crop-{object_id}.jpg" if include_crop else None, appearance_count=1, admin_memo=admin_memo, detected_at=detected_at, created_at=now))
    db.commit()


def seed_waste_detection(db: Session, *, object_id: int = 30, event_id: int = 40, processing_status: str = "CONFIRMED") -> None:
    now = datetime(2026, 1, 2, tzinfo=UTC)
    if db.get(Camera, 1) is None:
        db.add(Camera(id=1, code="CAM-1", name="테스트 카메라", area_name="잠실", is_active=True, created_at=now, updated_at=now))
    db.add(ObjectClass(id=2, code="TRASH", name_ko="폐기물", group_code="WASTE", display_order=2, is_active=True, created_at=now, updated_at=now))
    db.add(DetectionEvent(id=event_id, camera_id=1, source_type="IMAGE", original_media_url="/uploads/waste.jpg", status="COMPLETED", captured_at=now, created_at=now, updated_at=now))
    db.add(DetectedObject(id=object_id, detection_event_id=event_id, object_class_id=2, processing_status=processing_status, confidence=Decimal("0.9"), bbox_x=Decimal("1"), bbox_y=Decimal("2"), bbox_width=Decimal("30"), bbox_height=Decimal("40"), cropped_image_url="/uploads/waste-crop.jpg", appearance_count=1, detected_at=now, created_at=now))
    db.commit()


def test_ai_orm_models_and_found_item_detection_fk_match_database_contract() -> None:
    assert Camera.__tablename__ == "cameras"
    assert DetectionEvent.__tablename__ == "detection_events"
    assert VideoJob.__tablename__ == "video_jobs"
    assert DetectedObject.__tablename__ == "detected_objects"
    column = FoundItem.__table__.c.detected_object_id
    assert column.unique is True
    foreign_key = next(iter(column.foreign_keys))
    assert foreign_key.target_fullname == "detected_objects.id"
    assert foreign_key.ondelete == "SET NULL"


def test_detection_list_empty(client: TestClient, db: Session) -> None:
    seed_admin(db); login(client)
    response = client.get("/api/admin/detections")
    assert response.status_code == 200
    assert response.json() == []


def test_detection_list_returns_object_contract_and_recent_order(client: TestClient, db: Session) -> None:
    seed_admin(db)
    seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, 1, tzinfo=UTC))
    seed_detection(db, object_id=11, event_id=21, detected_at=datetime(2026, 1, 2, 2, tzinfo=UTC), confidence="0.9000")
    login(client)
    body = client.get("/api/admin/detections").json()
    assert [event["id"] for event in body] == [21, 20]
    item = body[0]["detected_objects"][0]
    assert item["object_class"] == "BAG"
    assert item["confidence"] == "0.9000"
    assert item["bbox_width"] == "30.0000"
    assert item["cropped_image_url"] == "/uploads/crop-11.jpg"
    assert item["ai_color"] is None
    assert item["confirmed_color"] is None
    assert item["admin_memo"] is None


def test_detected_object_admin_memo_persists_and_is_returned(client: TestClient, db: Session) -> None:
    seed_admin(db)
    seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, 1, tzinfo=UTC))
    login(client)
    updated = client.patch("/api/admin/detected-objects/10", json={"final_class_code": "BAG", "processing_status": "CONFIRMED", "admin_memo": "사진과 객체 경계를 확인함"})
    assert updated.status_code == 200
    item = client.get("/api/admin/detections").json()[0]["detected_objects"][0]
    assert item["final_class_code"] == "BAG"
    assert item["processing_status"] == "CONFIRMED"
    assert item["admin_memo"] == "사진과 객체 경계를 확인함"
    assert db.query(ProcessingHistory).filter_by(entity_type="DETECTED_OBJECT", entity_id=10, action_type="DETECTED_OBJECT_REVIEWED", note="사진과 객체 경계를 확인함").count() == 1


def test_admin_confirmed_color_persists_and_updates_existing_found_item(client: TestClient, db: Session) -> None:
    seed_admin(db)
    seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, 1, tzinfo=UTC))
    detected = db.get(DetectedObject, 10)
    detected.ai_color = "검정"
    now = datetime(2026, 1, 2, tzinfo=UTC)
    db.add(LostReport(id=50, user_id=1, object_class_id=1, color="남색", colors=["남색"], description="특징 없음", area_name="잠실", lost_from=now - timedelta(hours=1), status="OPEN", created_at=now, updated_at=now))
    db.commit(); login(client)

    saved = client.patch("/api/admin/detected-objects/10", json={"confirmed_color": "남색"})
    assert saved.status_code == 200
    refreshed = client.get("/api/admin/detections").json()[0]["detected_objects"][0]
    assert refreshed["ai_color"] == "검정"
    assert refreshed["confirmed_color"] == "남색"

    created = client.post("/api/admin/detected-objects/10/found-item")
    assert created.status_code == 201
    found = db.get(FoundItem, created.json()["found_item_id"])
    assert found.color == "남색"
    candidate = db.query(MatchCandidate).filter_by(found_item_id=found.id, lost_report_id=50).one()
    assert candidate.keyword_score == 10

    assert client.patch("/api/admin/detected-objects/10", json={"confirmed_color": "파랑"}).status_code == 200
    db.refresh(found)
    assert found.color == "파랑"
    db.refresh(candidate)
    assert candidate.keyword_score == 0


def test_reconcile_creates_updates_and_dismisses_candidates_without_duplicate_notifications(db: Session) -> None:
    seed_admin(db)
    now = datetime(2026, 1, 20, tzinfo=UTC)
    found = FoundItem(id=80, object_class_id=1, source_type="ADMIN", color="blue", area_name="found-area", found_at=now, status="AVAILABLE", is_public=True, created_at=now, updated_at=now)
    promoted = LostReport(id=81, user_id=1, object_class_id=1, color="red", colors=["red"], description="plain", area_name="lost-area", lost_from=now - timedelta(days=10), status="OPEN", created_at=now, updated_at=now)
    retained = LostReport(id=82, user_id=1, object_class_id=1, color="blue", colors=["blue"], description="plain", area_name="lost-area", lost_from=now - timedelta(days=10), status="MATCHED", created_at=now, updated_at=now)
    claimed = LostReport(id=83, user_id=1, object_class_id=1, color="blue", colors=["blue"], description="plain", area_name="lost-area", lost_from=now - timedelta(days=10), status="MATCHED", created_at=now, updated_at=now)
    db.add_all([found, promoted, retained, claimed]); db.flush()
    retained_candidate = MatchCandidate(lost_report_id=82, found_item_id=80, total_score=60, type_score=40, area_score=0, time_score=10, keyword_score=10, status="NOTIFIED", created_at=now, updated_at=now)
    claimed_candidate = MatchCandidate(lost_report_id=83, found_item_id=80, total_score=60, type_score=40, area_score=0, time_score=10, keyword_score=10, status="CLAIMED", created_at=now, updated_at=now)
    db.add_all([retained_candidate, claimed_candidate]); db.commit()

    found.color = "red"
    reconcile_match_candidates_for_found_item(db, found)
    db.commit()
    promoted_candidate = db.query(MatchCandidate).filter_by(lost_report_id=81, found_item_id=80).one()
    assert promoted_candidate.total_score == 60 and promoted_candidate.status == "NOTIFIED"
    assert db.query(Notification).filter_by(related_type="MATCH_CANDIDATE", related_id=promoted_candidate.id).count() == 1
    assert retained_candidate.total_score == 50 and retained_candidate.status == "DISMISSED"
    assert claimed_candidate.total_score == 50 and claimed_candidate.status == "CLAIMED"

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()
    assert db.query(MatchCandidate).filter_by(lost_report_id=81, found_item_id=80).count() == 1
    assert db.query(Notification).filter_by(related_type="MATCH_CANDIDATE", related_id=promoted_candidate.id).count() == 1


def test_reconcile_updates_existing_qualified_candidate_score(db: Session) -> None:
    seed_admin(db)
    now = datetime(2026, 1, 20, tzinfo=UTC)
    found = FoundItem(id=90, object_class_id=1, source_type="ADMIN", color="blue", area_name="same-area", found_at=now, status="AVAILABLE", is_public=True, created_at=now, updated_at=now)
    report = LostReport(id=91, user_id=1, object_class_id=1, color="blue", colors=["blue"], description="plain", area_name="same-area", lost_from=now - timedelta(days=10), status="MATCHED", created_at=now, updated_at=now)
    candidate = MatchCandidate(lost_report_id=91, found_item_id=90, total_score=60, type_score=40, area_score=0, time_score=10, keyword_score=10, status="NOTIFIED", created_at=now, updated_at=now)
    db.add_all([found, report, candidate]); db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()
    assert candidate.total_score == 85
    assert (candidate.type_score, candidate.area_score, candidate.time_score, candidate.keyword_score) == (40, 25, 10, 10)
    assert candidate.status == "NOTIFIED"


def test_admin_rejects_nonstandard_confirmed_color(client: TestClient, db: Session) -> None:
    seed_admin(db); seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, 1, tzinfo=UTC)); login(client)
    assert client.patch("/api/admin/detected-objects/10", json={"confirmed_color": "임의색"}).status_code == 422


def test_admin_creates_ai_found_item_reverse_match_and_prevents_duplicate(client: TestClient, db: Session) -> None:
    seed_admin(db); seed_user(db)
    found_at = datetime(2026, 1, 2, 1, tzinfo=UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=found_at)
    db.add(LostReport(id=50, user_id=2, object_class_id=1, color=None, description="검정 가방", area_name="잠실", lost_from=found_at - timedelta(hours=1), status="OPEN", created_at=found_at, updated_at=found_at))
    db.add(LostReport(id=51, user_id=2, object_class_id=1, color=None, description="가방", area_name="강남", lost_from=found_at - timedelta(days=40), status="OPEN", created_at=found_at, updated_at=found_at))
    for report_id, report_status in ((52, "MATCHED"), (53, "CLAIM_PENDING"), (54, "RESOLVED"), (55, "CANCELLED")):
        db.add(LostReport(id=report_id, user_id=2, object_class_id=1, color=None, description="검정 가방", area_name="잠실", lost_from=found_at - timedelta(hours=1), status=report_status, created_at=found_at, updated_at=found_at))
    db.commit(); login(client)

    response = client.post("/api/admin/detected-objects/10/found-item")
    assert response.status_code == 201
    result = response.json()
    found = db.get(FoundItem, result["found_item_id"])
    assert found is not None
    assert found.detected_object_id == 10
    assert found.source_type == "AI"
    assert found.status == "AVAILABLE" and found.is_public is True
    assert found.area_name == "잠실"
    assert db.query(MatchCandidate).filter_by(lost_report_id=50, found_item_id=found.id).count() == 1
    assert db.query(MatchCandidate).filter_by(lost_report_id=51, found_item_id=found.id).count() == 0
    assert db.query(MatchCandidate).filter_by(lost_report_id=52, found_item_id=found.id).count() == 1
    assert all(db.query(MatchCandidate).filter_by(lost_report_id=report_id, found_item_id=found.id).count() == 0 for report_id in (53, 54, 55))
    assert db.query(Notification).filter_by(user_id=2, notification_type="MATCH_FOUND").count() == 2
    if found.found_at.tzinfo is None:  # SQLite fixture loses TIMESTAMPTZ metadata; PostgreSQL does not.
        found.found_at = found.found_at.replace(tzinfo=UTC)
    create_match_candidates_for_found_item(db, found)
    assert db.query(MatchCandidate).filter_by(lost_report_id=50, found_item_id=found.id).count() == 1
    assert db.query(Notification).filter_by(user_id=2, notification_type="MATCH_FOUND").count() == 2
    history = db.query(ProcessingHistory).filter_by(entity_type="DETECTED_OBJECT", entity_id=10, action_type="DETECTED_OBJECT_FOUND_ITEM_CREATED").one()
    assert f"found_item_id={found.id}" == history.note
    assert client.post("/api/admin/detected-objects/10/found-item").status_code == 409
    assert db.query(FoundItem).filter_by(detected_object_id=10).count() == 1
    listed = client.get("/api/found-items").json()
    assert any(item["id"] == found.id and item["image_url"] == "/uploads/crop-10.jpg" for item in listed)


@pytest.mark.parametrize("processing_status", ["PENDING", "REJECTED"])
def test_ai_found_item_requires_confirmed_review(client: TestClient, db: Session, processing_status: str) -> None:
    seed_admin(db); seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, tzinfo=UTC))
    db.get(DetectedObject, 10).processing_status = processing_status; db.commit(); login(client)
    assert client.post("/api/admin/detected-objects/10/found-item").status_code == 409
    assert db.query(FoundItem).count() == 0


def test_waste_cannot_become_found_item_and_personal_item_cannot_be_collected(client: TestClient, db: Session) -> None:
    seed_admin(db); seed_waste_detection(db); seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 3, tzinfo=UTC)); login(client)
    assert client.post("/api/admin/detected-objects/30/found-item").status_code == 422
    assert client.post("/api/admin/detected-objects/10/collect").status_code == 422


def test_admin_collects_waste_persists_state_and_prevents_duplicate(client: TestClient, db: Session) -> None:
    seed_admin(db); seed_waste_detection(db); login(client)
    response = client.post("/api/admin/detected-objects/30/collect")
    assert response.status_code == 200
    assert response.json()["waste_collection_completed"] is True
    assert db.query(ProcessingHistory).filter_by(entity_type="DETECTED_OBJECT", entity_id=30, action_type="WASTE_COLLECTION_COMPLETED").count() == 1
    item = client.get("/api/admin/detections").json()[0]["detected_objects"][0]
    assert item["follow_up_kind"] == "WASTE" and item["waste_collection_completed"] is True
    assert client.post("/api/admin/detected-objects/30/collect").status_code == 409


def test_completed_follow_up_locks_class_and_status_but_allows_memo_and_color(client: TestClient, db: Session) -> None:
    seed_admin(db); seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, tzinfo=UTC)); seed_waste_detection(db); login(client)
    assert client.post("/api/admin/detected-objects/10/found-item").status_code == 201
    assert client.patch("/api/admin/detected-objects/10", json={"final_class_code": "TRASH"}).status_code == 409
    assert client.patch("/api/admin/detected-objects/10", json={"processing_status": "REJECTED"}).status_code == 409
    allowed = client.patch("/api/admin/detected-objects/10", json={"admin_memo": "review complete"})
    assert allowed.status_code == 200
    item = db.get(DetectedObject, 10)
    assert item.processing_status == "CONFIRMED" and (item.final_class or item.object_class).code == "BAG"

    assert client.post("/api/admin/detected-objects/30/collect").status_code == 200
    assert client.patch("/api/admin/detected-objects/30", json={"final_class_code": "BAG"}).status_code == 409
    assert client.patch("/api/admin/detected-objects/30", json={"processing_status": "REJECTED"}).status_code == 409


def test_user_cannot_run_detection_follow_up(client: TestClient, db: Session) -> None:
    seed_user(db); seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, tzinfo=UTC)); seed_waste_detection(db); login_user(client)
    assert client.post("/api/admin/detected-objects/10/found-item").status_code == 403
    assert client.post("/api/admin/detected-objects/30/collect").status_code == 403


def test_admin_camera_list_only_exposes_active_located_cameras(client: TestClient, db: Session) -> None:
    seed_admin(db)
    now = datetime(2026, 1, 2, tzinfo=UTC)
    db.add_all([
        Camera(id=1, code="READY", name="발표 카메라", area_name="서울시청", latitude=Decimal("37.566295"), longitude=Decimal("126.977945"), is_active=True, created_at=now, updated_at=now),
        Camera(id=2, code="NO-LOCATION", name="위치 없음", area_name="미지정", is_active=True, created_at=now, updated_at=now),
        Camera(id=3, code="INACTIVE", name="비활성", area_name="서울", latitude=Decimal("37.5"), longitude=Decimal("127.0"), is_active=False, created_at=now, updated_at=now),
    ])
    db.commit(); login(client)
    response = client.get("/api/admin/cameras")
    assert response.status_code == 200
    assert response.json() == [{"id": 1, "code": "READY", "name": "발표 카메라", "area_name": "서울시청", "latitude": "37.566295", "longitude": "126.977945"}]


def test_user_analysis_has_no_follow_up_and_is_blocked_by_services(client: TestClient, db: Session) -> None:
    seed_admin(db)
    seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, tzinfo=UTC), purpose="USER_ANALYSIS")
    seed_waste_detection(db, object_id=30, event_id=40)
    db.get(DetectionEvent, 40).purpose = "USER_ANALYSIS"
    db.commit(); login(client)
    events = client.get("/api/admin/detections").json()
    assert {event["purpose"] for event in events} == {"USER_ANALYSIS"}
    assert all(item["follow_up_kind"] == "NONE" for event in events for item in event["detected_objects"])
    assert client.post("/api/admin/detected-objects/10/found-item").status_code == 409
    assert client.post("/api/admin/detected-objects/30/collect").status_code == 409
    assert db.query(FoundItem).count() == 0
    assert db.query(ProcessingHistory).filter_by(action_type="WASTE_COLLECTION_COMPLETED").count() == 0


def test_dashboard_uses_kst_today_boundary_and_ai_categories(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)  # 1월 2일 12:00 KST
    seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 1, 14, 59, tzinfo=UTC))
    seed_detection(db, object_id=11, event_id=21, detected_at=datetime(2026, 1, 1, 15, 0, tzinfo=UTC), confidence="0.9250")
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)
    body = client.get("/api/admin/dashboard", params={"period": "today"}).json()
    assert body["metrics"]["discovered"] == 0
    assert body["metrics"]["ai_detections"] == 1
    assert body["category_counts"] == [{"code": "BAG", "name": "가방", "count": 1}]
    assert len(body["recent_detections"]) == 1
    assert body["average_confidence"] == "0.925"


def test_dashboard_supports_seven_days_and_all(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 8, 3, tzinfo=UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=fixed_now - timedelta(days=6))
    seed_detection(db, object_id=11, event_id=21, detected_at=fixed_now - timedelta(days=8))
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)
    assert client.get("/api/admin/dashboard", params={"period": "7d"}).json()["metrics"]["ai_detections"] == 1
    assert client.get("/api/admin/dashboard", params={"period": "all"}).json()["metrics"]["ai_detections"] == 2


@pytest.mark.parametrize(
    ("source_type", "include_crop", "expected_image_url"),
    [
        ("IMAGE", False, "/uploads/20.jpg"),
        ("VIDEO", False, None),
        ("VIDEO", True, "/uploads/crop-10.jpg"),
    ],
)
def test_dashboard_recent_detection_uses_only_renderable_image_media(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    source_type: str,
    include_crop: bool,
    expected_image_url: str | None,
) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_detection(
        db,
        object_id=10,
        event_id=20,
        detected_at=fixed_now,
        source_type=source_type,
        include_crop=include_crop,
    )
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    assert response.json()["recent_detections"][0]["image_url"] == expected_image_url
