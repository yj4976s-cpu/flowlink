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
from app.services.matching import create_match_candidates_for_found_item


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


def seed_detection(db: Session, *, object_id: int, event_id: int, detected_at: datetime, confidence: str = "0.8750", source_type: str = "IMAGE", include_crop: bool = True, admin_memo: str | None = None) -> None:
    now = detected_at
    if db.get(ObjectClass, 1) is None:
        db.add(ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now))
    if db.get(Camera, 1) is None:
        db.add(Camera(id=1, code="CAM-1", name="테스트 카메라", area_name="잠실", is_active=True, created_at=now, updated_at=now))
    extension = "jpg" if source_type == "IMAGE" else "mp4"
    db.add(DetectionEvent(id=event_id, camera_id=1, source_type=source_type, original_media_url=f"/uploads/{event_id}.{extension}", result_media_url=None, status="COMPLETED", captured_at=detected_at, processing_started_at=detected_at, processing_completed_at=detected_at, created_at=now, updated_at=now))
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


def test_admin_creates_ai_found_item_reverse_match_and_prevents_duplicate(client: TestClient, db: Session) -> None:
    seed_admin(db); seed_user(db)
    found_at = datetime(2026, 1, 2, 1, tzinfo=UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=found_at)
    db.add(LostReport(id=50, user_id=2, object_class_id=1, color=None, description="검정 가방", area_name="잠실", lost_from=found_at - timedelta(hours=1), status="OPEN", created_at=found_at, updated_at=found_at))
    db.add(LostReport(id=51, user_id=2, object_class_id=1, color=None, description="가방", area_name="강남", lost_from=found_at - timedelta(days=40), status="OPEN", created_at=found_at, updated_at=found_at))
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
    assert db.query(Notification).filter_by(user_id=2, notification_type="MATCH_FOUND").count() == 1
    if found.found_at.tzinfo is None:  # SQLite fixture loses TIMESTAMPTZ metadata; PostgreSQL does not.
        found.found_at = found.found_at.replace(tzinfo=UTC)
    create_match_candidates_for_found_item(db, found)
    assert db.query(MatchCandidate).filter_by(lost_report_id=50, found_item_id=found.id).count() == 1
    assert db.query(Notification).filter_by(user_id=2, notification_type="MATCH_FOUND").count() == 1
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


def test_user_cannot_run_detection_follow_up(client: TestClient, db: Session) -> None:
    seed_user(db); seed_detection(db, object_id=10, event_id=20, detected_at=datetime(2026, 1, 2, tzinfo=UTC)); seed_waste_detection(db); login_user(client)
    assert client.post("/api/admin/detected-objects/10/found-item").status_code == 403
    assert client.post("/api/admin/detected-objects/30/collect").status_code == 403


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
