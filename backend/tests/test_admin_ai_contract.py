from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.admin as admin_api
import app.services.geocoding as geocoding_service
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import Base, get_db
from app.main import app
from app.models import Camera, DetectedObject, DetectionEvent, FoundItem, LostReport, MatchCandidate, Notification, ObjectClass, OwnershipClaim, ProcessingHistory, User, VideoJob
from app.services.matching import create_match_candidates_for_found_item, reconcile_match_candidates_for_found_item
from app.services.geocoding import Coordinates
from app.services.detection_inference import DetectionBBox, DetectionInferenceResult, DetectionPrediction, get_inference_service
from app.services.copilot_providers import ChatStatus, ProviderResponseError, ProviderResult
from app.repositories.user_flow import admin_report_period_window, get_admin_ai_report_data


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


class MockInferenceService:
    def __init__(self, result: DetectionInferenceResult):
        self.result = result

    def analyze_image(self, media_path: Path) -> DetectionInferenceResult:
        return self.result


def jpeg_bytes(*, width: int = 160, height: int = 120) -> bytes:
    payload = BytesIO()
    Image.new("RGB", (width, height), color=(80, 90, 100)).save(payload, format="JPEG")
    return payload.getvalue()


def mobile_waste_files(content: bytes | None = None, content_type: str = "image/jpeg") -> dict[str, tuple[str, BytesIO, str]]:
    return {"file": ("mobile-waste.jpg", BytesIO(content if content is not None else jpeg_bytes()), content_type)}


def mobile_waste_form(camera_id: int = 1, *, x: float = 10, y: float = 12, width: float = 40, height: float = 32) -> dict[str, str]:
    return {
        "camera_id": str(camera_id),
        "bbox_x": str(x),
        "bbox_y": str(y),
        "bbox_width": str(width),
        "bbox_height": str(height),
    }


def override_mobile_waste_inference(result: DetectionInferenceResult) -> None:
    app.dependency_overrides[get_inference_service] = lambda: MockInferenceService(result)


def seed_detection(db: Session, *, object_id: int, event_id: int, detected_at: datetime, confidence: str = "0.8750", source_type: str = "IMAGE", include_crop: bool = True, admin_memo: str | None = None, purpose: str = "OPERATION", processing_status: str = "CONFIRMED") -> None:
    now = detected_at
    if db.get(ObjectClass, 1) is None:
        db.add(ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now))
    if db.get(Camera, 1) is None:
        db.add(Camera(id=1, code="CAM-1", name="테스트 카메라", area_name="잠실", is_active=True, created_at=now, updated_at=now))
    extension = "jpg" if source_type == "IMAGE" else "mp4"
    db.add(DetectionEvent(id=event_id, camera_id=1, purpose=purpose, source_type=source_type, original_media_url=f"/uploads/{event_id}.{extension}", result_media_url=None, status="COMPLETED", captured_at=detected_at, processing_started_at=detected_at, processing_completed_at=detected_at, created_at=now, updated_at=now))
    db.add(DetectedObject(id=object_id, detection_event_id=event_id, object_class_id=1, processing_status=processing_status, confidence=Decimal(confidence), bbox_x=Decimal("1"), bbox_y=Decimal("2"), bbox_width=Decimal("30"), bbox_height=Decimal("40"), cropped_image_url=f"/uploads/crop-{object_id}.jpg" if include_crop else None, appearance_count=1, admin_memo=admin_memo, detected_at=detected_at, created_at=now))
    db.commit()


def seed_waste_detection(db: Session, *, object_id: int = 30, event_id: int = 40, processing_status: str = "CONFIRMED") -> None:
    now = datetime(2026, 1, 2, tzinfo=UTC)
    if db.get(Camera, 1) is None:
        db.add(Camera(id=1, code="CAM-1", name="테스트 카메라", area_name="잠실", is_active=True, created_at=now, updated_at=now))
    if db.get(ObjectClass, 2) is None:
        db.add(ObjectClass(id=2, code="TRASH", name_ko="폐기물", group_code="WASTE", display_order=2, is_active=True, created_at=now, updated_at=now))
    db.add(DetectionEvent(id=event_id, camera_id=1, source_type="IMAGE", original_media_url="/uploads/waste.jpg", status="COMPLETED", captured_at=now, created_at=now, updated_at=now))
    db.add(DetectedObject(id=object_id, detection_event_id=event_id, object_class_id=2, processing_status=processing_status, confidence=Decimal("0.9"), bbox_x=Decimal("1"), bbox_y=Decimal("2"), bbox_width=Decimal("30"), bbox_height=Decimal("40"), cropped_image_url="/uploads/waste-crop.jpg", appearance_count=1, detected_at=now, created_at=now))
    db.commit()


def seed_mobile_waste_prerequisites(db: Session) -> None:
    now = datetime(2026, 1, 2, tzinfo=UTC)
    if db.get(Camera, 1) is None:
        db.add(Camera(id=1, code="CAM-1", name="테스트 카메라", area_name="잠실", is_active=True, created_at=now, updated_at=now))
    if db.get(ObjectClass, 1) is None:
        db.add(ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now))
    if db.get(ObjectClass, 2) is None:
        db.add(ObjectClass(id=2, code="TRASH", name_ko="폐기물", group_code="WASTE", display_order=2, is_active=True, created_at=now, updated_at=now))
    db.commit()


def seed_admin_found_item(
    db: Session,
    *,
    item_id: int = 3,
    area_name: str = "서울시청",
    latitude: Decimal | None = None,
    longitude: Decimal | None = None,
) -> FoundItem:
    now = datetime(2026, 1, 2, tzinfo=UTC)
    if db.get(ObjectClass, 1) is None:
        db.add(
            ObjectClass(
                id=1,
                code="BAG",
                name_ko="가방",
                group_code="PERSONAL_ITEM",
                display_order=1,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
    item = FoundItem(
        id=item_id,
        object_class_id=1,
        registered_by=1,
        source_type="ADMIN",
        area_name=area_name,
        latitude=latitude,
        longitude=longitude,
        found_at=now,
        status="AVAILABLE",
        is_public=True,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    return item


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


def test_admin_archives_found_item_and_public_surfaces_exclude_it(client: TestClient, db: Session) -> None:
    seed_admin(db)
    item = seed_admin_found_item(db, item_id=301, latitude=Decimal("37.566500"), longitude=Decimal("126.978000"))
    login(client)

    response = client.post(f"/api/admin/found-items/{item.id}/archive")

    assert response.status_code == 200
    db.refresh(item)
    assert item.status == "ARCHIVED"
    assert item.is_public is False
    assert client.get("/api/admin/found-items").json()["items"] == []
    archived = client.get("/api/admin/found-items", params={"status": "ARCHIVED"}).json()
    assert [row["id"] for row in archived["items"]] == [item.id]
    assert client.get("/api/found-items").json() == []
    assert client.get(f"/api/found-items/{item.id}").status_code == 404
    assert client.get("/api/found-items/map").json() == []
    home = client.get("/api/system/home-summary").json()
    assert home["stats"]["recent_found"] == 0
    assert home["recent_items"] == []
    dashboard = client.get("/api/admin/dashboard", params={"period": "all"}).json()
    assert dashboard["metrics"]["official_found_items"] == 0
    assert dashboard["recent_items"] == []


def test_admin_archive_requires_admin_and_blocks_active_claim(client: TestClient, db: Session) -> None:
    seed_admin(db)
    seed_user(db)
    item = seed_admin_found_item(db, item_id=302)
    now = datetime(2026, 1, 3, tzinfo=UTC)
    db.add(OwnershipClaim(id=401, user_id=2, found_item_id=item.id, verification_details="details", status="PENDING", created_at=now, updated_at=now))
    db.commit()

    login_user(client)
    assert client.post(f"/api/admin/found-items/{item.id}/archive").status_code == 403
    client.post("/api/auth/logout")
    login(client)
    response = client.post(f"/api/admin/found-items/{item.id}/archive")

    assert response.status_code == 409
    db.refresh(item)
    assert item.status == "AVAILABLE"
    assert item.is_public is True


def test_admin_ai_report_aggregates_only_operational_objects(client: TestClient, db: Session) -> None:
    seed_admin(db)
    now = datetime.now(UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=now, confidence="0.5500", processing_status="PENDING")
    seed_detection(db, object_id=11, event_id=21, detected_at=now, confidence="0.6500", processing_status="CONFIRMED")
    seed_detection(db, object_id=12, event_id=22, detected_at=now, confidence="0.7500", processing_status="REJECTED")
    seed_detection(db, object_id=13, event_id=23, detected_at=now, confidence="0.8500", processing_status="PENDING")
    seed_detection(db, object_id=14, event_id=24, detected_at=now, confidence="0.9500", processing_status="CONFIRMED")
    seed_detection(db, object_id=15, event_id=25, detected_at=now, confidence="0.1000", purpose="USER_ANALYSIS")
    db.add(ObjectClass(id=2, code="FOOTWEAR", name_ko="신발", group_code="PERSONAL_ITEM", display_order=2, is_active=True, created_at=now, updated_at=now))
    corrected = db.get(DetectedObject, 14)
    corrected.final_class_code = "FOOTWEAR"
    db.commit(); login(client)

    response = client.get("/api/admin/ai-report")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == {"total": 5, "average_confidence": "0.75", "reviewed": 3, "corrected": 1}
    assert body["class_metrics"] == [
        {"code": "BAG", "name": db.get(ObjectClass, 1).name_ko, "count": 5, "ratio": 1.0, "average_confidence": "0.75", "reviewed": 3, "corrected": 1},
        {"code": "FOOTWEAR", "name": "신발", "count": 0, "ratio": 0.0, "average_confidence": None, "reviewed": 0, "corrected": 0},
    ]
    assert [item["count"] for item in body["confidence_distribution"]] == [0, 1, 1, 1, 1, 1]
    assert body["correction_patterns"] == [{"predicted_code": "BAG", "predicted_name": db.get(ObjectClass, 1).name_ko, "final_code": "FOOTWEAR", "final_name": "신발", "count": 1}]


def test_admin_ai_report_handles_empty_data_and_requires_admin(client: TestClient, db: Session) -> None:
    seed_user(db); login_user(client)
    assert client.get("/api/admin/ai-report").status_code == 403
    client.post("/api/auth/logout")
    seed_admin(db); login(client)
    body = client.get("/api/admin/ai-report").json()
    assert body["summary"] == {"total": 0, "average_confidence": None, "reviewed": 0, "corrected": 0}
    assert body["class_metrics"] == [] and body["correction_patterns"] == []
    assert len(body["confidence_distribution"]) == 6
    assert body["period_days"] == 30
    assert len(body["daily_trend"]) == 30
    assert sum(item["detection_count"] for item in body["daily_trend"]) == 0


@pytest.mark.parametrize("days", [7, 30, 90])
def test_admin_ai_report_period_window_uses_kst_calendar_days(days: int) -> None:
    period_start, period_end, trend_dates = admin_report_period_window(days, now=datetime(2026, 9, 1, 15, 30, tzinfo=UTC))

    assert period_start.astimezone(UTC).tzinfo is UTC
    assert period_end.isoformat() == "2026-09-01T15:30:00+00:00"
    assert len(trend_dates) == days
    assert trend_dates[-1] == "2026-09-02"


def test_admin_ai_report_rejects_unsupported_days(client: TestClient, db: Session) -> None:
    seed_admin(db); login(client)

    assert client.get("/api/admin/ai-report?days=14").status_code == 422


def test_admin_ai_report_separates_period_metrics_from_current_backlog(db: Session) -> None:
    seed_admin(db)
    now = datetime(2026, 9, 1, 15, 30, tzinfo=UTC)
    period_start, _, _ = admin_report_period_window(7, now=now)
    before = period_start - timedelta(seconds=1)
    inside = period_start
    seed_detection(db, object_id=101, event_id=201, detected_at=inside, confidence="0.8000", processing_status="PENDING")
    seed_detection(db, object_id=102, event_id=202, detected_at=before, confidence="0.9900", processing_status="PENDING")
    seed_detection(db, object_id=103, event_id=203, detected_at=inside, confidence="0.1000", purpose="USER_ANALYSIS", processing_status="PENDING")

    body = get_admin_ai_report_data(db, days=7, now=now)

    assert body["operation_summary"]["operation_detection_events"] == 1
    assert body["summary"]["total"] == 1
    assert sum(item["detection_count"] for item in body["daily_trend"]) == 1
    assert sum(item["detected_object_count"] for item in body["daily_trend"]) == 1
    assert body["daily_trend"][0]["detection_count"] == 1
    assert body["queue_tasks"][0]["count"] == 2
    assert body["queue_tasks"][0]["href"] == "/admin/detections"
    assert body["queue_tasks"][1]["href"] == "/admin/detections?followUp=WASTE_PENDING"
    assert body["queue_tasks"][2]["href"] == "/admin/citizen-reports?status=PENDING"
    assert body["queue_tasks"][3]["href"] == "/admin/ownership-claims?status=PENDING"
    assert body["queue_tasks"][4]["href"] == "/admin/ownership-claims?status=APPROVED"
    assert "USER_ANALYSIS" not in str(body["operation_summary"])


def admin_briefing_dashboard() -> dict:
    return {
        "metrics": {
            "operation_detection_pending": 3,
            "waste_collection_pending": 2,
            "citizen_review_pending": 1,
            "ownership_claim_pending": 4,
            "ownership_return_pending": 5,
        },
        "average_confidence": Decimal("0.847"),
    }


def test_admin_operations_briefing_status_does_not_call_provider(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    login(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "CHAT_MODEL_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "gemini-test")
    monkeypatch.setattr("app.services.admin_operations_briefing.create_chat_provider", lambda *_: (_ for _ in ()).throw(AssertionError("status must not call Gemini")))

    response = client.get("/api/admin/ai-report/operations-briefing/status")

    assert response.status_code == 200
    body = response.json()
    assert body["gemini_configured"] is True
    assert body["gemini_connected"] is False
    assert body["model"] == "gemini-test"


def test_admin_operations_briefing_requires_admin(client: TestClient, db: Session) -> None:
    seed_user(db)
    login_user(client)

    assert client.get("/api/admin/ai-report/operations-briefing/status").status_code == 403
    assert client.post("/api/admin/ai-report/operations-briefing").status_code == 403


def test_admin_operations_briefing_uses_rule_based_fallback_without_gemini(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    login(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "CHAT_MODEL_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr("app.services.admin_operations_briefing.get_admin_dashboard_data", lambda *_args, **_kwargs: admin_briefing_dashboard())
    monkeypatch.setattr("app.services.admin_operations_briefing.create_chat_provider", lambda *_: (_ for _ in ()).throw(AssertionError("Gemini must not be called without a key")))

    response = client.post("/api/admin/ai-report/operations-briefing")

    assert response.status_code == 200
    body = response.json()
    assert "오늘 확인이 필요한 운영 작업" in body["summary"]
    assert body["metrics"]["operation_detection_pending"] == 3
    assert body["metrics"]["waste_collection_pending"] == 2
    assert body["metrics"]["citizen_review_pending"] == 1
    assert body["metrics"]["ownership_claim_pending"] == 4
    assert body["metrics"]["ownership_return_pending"] == 5
    assert body["metrics"]["average_confidence"] == "0.847"
    assert body["priority_task"]["label"] == "탐지 검토 대기"
    assert body["tasks"][0]["href"] == "/admin/detections"
    assert body["tasks"][1]["href"] == "/admin/detections?followUp=WASTE_PENDING"
    assert body["fallback_used"] is True
    assert body["gemini_connected"] is False
    assert body["fallback_reason"] == "NOT_CONFIGURED"


def test_admin_operations_briefing_can_use_gemini_on_manual_request(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    class Provider:
        async def generate(self, **_kwargs):
            return ProviderResult(text='{"message":"오늘은 소유권 요청과 반환 대기를 먼저 확인하세요."}', provider="gemini", model="gemini-test")

    seed_admin(db)
    login(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "CHAT_MODEL_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "gemini-test")
    monkeypatch.setattr("app.services.admin_operations_briefing.get_admin_dashboard_data", lambda *_args, **_kwargs: admin_briefing_dashboard())
    monkeypatch.setattr("app.services.admin_operations_briefing.create_chat_provider", lambda *_: Provider())

    response = client.post("/api/admin/ai-report/operations-briefing")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "오늘은 소유권 요청과 반환 대기를 먼저 확인하세요."
    assert body["provider"] == "gemini"
    assert body["model"] == "gemini-test"
    assert body["gemini_connected"] is True
    assert body["fallback_used"] is False


@pytest.mark.parametrize("error", [
    ProviderResponseError("upstream quota exhausted: secret-test-key", status=ChatStatus.RATE_LIMITED, upstream_status=429),
    RuntimeError("internal stack trace with secret-test-key"),
])
def test_admin_operations_briefing_provider_errors_fall_back_without_leaking_details(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
) -> None:
    class Provider:
        async def generate(self, **_kwargs):
            raise error

    seed_admin(db)
    login(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "CHAT_MODEL_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "secret-test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "gemini-test")
    monkeypatch.setattr("app.services.admin_operations_briefing.get_admin_dashboard_data", lambda *_args, **_kwargs: admin_briefing_dashboard())
    monkeypatch.setattr("app.services.admin_operations_briefing.create_chat_provider", lambda *_: Provider())

    response = client.post("/api/admin/ai-report/operations-briefing")

    assert response.status_code == 200
    body = response.json()
    serialized = response.text
    assert body["fallback_used"] is True
    assert body["gemini_connected"] is False
    assert body["fallback_reason"] == "PROVIDER_UNAVAILABLE"
    assert "secret-test-key" not in serialized
    assert "quota exhausted" not in serialized
    assert "internal stack trace" not in serialized


def test_admin_found_item_register_supports_full_lifecycle_counts_filters_and_pagination(client: TestClient, db: Session) -> None:
    seed_admin(db)
    now = datetime(2026, 1, 2, tzinfo=UTC)
    if db.get(ObjectClass, 1) is None:
        db.add(ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now))
    statuses = ("DETECTED", "RECOVERED", "AVAILABLE", "CLAIM_PENDING", "RETURNED", "DISPOSED")
    counts = (1, 2, 3, 4, 5, 6)
    item_id = 1
    for item_status, count in zip(statuses, counts, strict=True):
        for index in range(count):
            db.add(FoundItem(id=item_id, object_class_id=1, registered_by=1, source_type="ADMIN", area_name=f"장소 {item_id}", storage_location=f"보관함 {index}", found_at=now, status=item_status, is_public=item_status in {"RECOVERED", "AVAILABLE"}, created_at=now, updated_at=now + timedelta(minutes=item_id)))
            item_id += 1
    db.commit(); login(client)

    first_page = client.get("/api/admin/found-items", params={"skip": 0, "limit": 5})
    assert first_page.status_code == 200
    body = first_page.json()
    assert len(body["items"]) == 5
    assert body["total"] == 21
    assert {entry["status"]: entry["count"] for entry in body["status_counts"]} == dict(zip(statuses, counts, strict=True))
    assert {entry["status"] for entry in body["items"]}.issubset(set(statuses))
    assert all("storage_location" in entry and "updated_at" in entry for entry in body["items"])

    returned = client.get("/api/admin/found-items", params={"status": "RETURNED", "skip": 0, "limit": 2}).json()
    assert returned["total"] == 5
    assert len(returned["items"]) == 2
    assert {entry["status"] for entry in returned["items"]} == {"RETURNED"}
    assert sum(entry["count"] for entry in returned["status_counts"]) == 21
    assert client.get("/api/admin/found-items", params={"q": "보관함 0"}).json()["total"] == 6
    archived = client.get("/api/admin/found-items", params={"status": "ARCHIVED"})
    assert archived.status_code == 200
    assert archived.json()["items"] == []
    assert archived.json()["total"] == 0


def test_recovered_found_item_is_automatically_geocoded_for_map(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    seed_admin_found_item(db)
    login(client)
    monkeypatch.setattr(admin_api, "geocode_location", lambda query: Coordinates(latitude=37.5663, longitude=126.9779))

    response = client.patch("/api/admin/found-items/3", json={"status": "RECOVERED"})

    assert response.status_code == 200
    item = db.get(FoundItem, 3)
    assert item.latitude == Decimal("37.5663") and item.longitude == Decimal("126.9779")
    assert [entry["id"] for entry in client.get("/api/found-items/map").json()] == [3]


def test_recovered_found_item_with_existing_coordinates_skips_geocoding(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_admin(db)
    seed_admin_found_item(db, latitude=Decimal("37.500000"), longitude=Decimal("127.000000"))
    login(client)

    def fail_geocoding(query: str):
        raise AssertionError(f"geocoding should not be called for {query}")

    monkeypatch.setattr(admin_api, "geocode_location", fail_geocoding)

    response = client.patch("/api/admin/found-items/3", json={"status": "RECOVERED"})

    assert response.status_code == 200
    item = db.get(FoundItem, 3)
    assert item.status == "RECOVERED"
    assert item.latitude == Decimal("37.500000")
    assert item.longitude == Decimal("127.000000")


def test_recovered_found_item_without_kakao_key_rolls_back(
    client: TestClient,
    db: Session,
) -> None:
    seed_admin(db)
    seed_admin_found_item(db)
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"status": "RECOVERED"})

    assert response.status_code == 503
    assert "KAKAO_REST_API_KEY" in response.json()["detail"]
    item = db.get(FoundItem, 3)
    assert item.status == "AVAILABLE"
    assert item.latitude is None and item.longitude is None
    assert db.query(ProcessingHistory).filter_by(entity_type="FOUND_ITEM", entity_id=3).count() == 0


def test_recovered_found_item_unmatched_geocoding_rolls_back(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_admin(db)
    seed_admin_found_item(db)
    login(client)
    monkeypatch.setattr(admin_api, "geocode_location", lambda query: None)

    response = client.patch("/api/admin/found-items/3", json={"status": "RECOVERED"})

    assert response.status_code == 422
    assert "위도/경도" in response.json()["detail"]
    item = db.get(FoundItem, 3)
    assert item.status == "AVAILABLE"
    assert item.latitude is None and item.longitude is None
    assert db.query(ProcessingHistory).filter_by(entity_type="FOUND_ITEM", entity_id=3).count() == 0


def test_recovered_found_item_uses_keyword_fallback_after_address_miss(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_admin(db)
    seed_admin_found_item(db, area_name="수원역")
    login(client)
    monkeypatch.setattr(geocoding_service.get_settings(), "KAKAO_REST_API_KEY", "test-rest-key")
    requested_paths: list[str] = []

    class FakeKakaoResponse:
        def __init__(self, documents: list[dict[str, str]]) -> None:
            self._documents = documents

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, list[dict[str, str]]]:
            return {"documents": self._documents}

    class FakeKakaoClient:
        def __init__(self, timeout: int) -> None:
            assert timeout == 8

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            return None

        def get(self, url: str, **kwargs):
            assert kwargs["params"] == {"query": "수원역", "size": 1}
            requested_paths.append(url.rsplit("/", 1)[-1])
            if url.endswith("search/address.json"):
                return FakeKakaoResponse([])
            return FakeKakaoResponse([{"y": "37.2656", "x": "127.0001"}])

    monkeypatch.setattr(geocoding_service.httpx, "Client", FakeKakaoClient)

    response = client.patch("/api/admin/found-items/3", json={"status": "RECOVERED"})

    assert response.status_code == 200
    assert requested_paths == ["address.json", "keyword.json"]
    item = db.get(FoundItem, 3)
    assert item.status == "RECOVERED"
    assert item.latitude == Decimal("37.2656")
    assert item.longitude == Decimal("127.0001")


def test_found_item_update_area_name_then_geocodes(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_admin(db)
    seed_admin_found_item(db, area_name="오래된 위치")
    login(client)

    def geocode_updated_area(query: str) -> Coordinates:
        assert query == "수원역 4번 출구"
        return Coordinates(latitude=37.266, longitude=127.001)

    monkeypatch.setattr(admin_api, "geocode_location", geocode_updated_area)

    response = client.patch(
        "/api/admin/found-items/3",
        json={"status": "RECOVERED", "area_name": "수원역 4번 출구"},
    )

    assert response.status_code == 200
    item = db.get(FoundItem, 3)
    assert item.area_name == "수원역 4번 출구"
    assert item.latitude == Decimal("37.266")
    assert item.longitude == Decimal("127.001")


def test_found_item_manual_coordinates_skip_geocoding(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_admin(db)
    seed_admin_found_item(db)
    login(client)

    def fail_geocoding(query: str):
        raise AssertionError(f"geocoding should not be called for {query}")

    monkeypatch.setattr(admin_api, "geocode_location", fail_geocoding)

    response = client.patch(
        "/api/admin/found-items/3",
        json={"status": "RECOVERED", "latitude": 37.123456, "longitude": 127.654321},
    )

    assert response.status_code == 200
    item = db.get(FoundItem, 3)
    assert item.status == "RECOVERED"
    assert item.latitude == Decimal("37.123456")
    assert item.longitude == Decimal("127.654321")


def seed_found_item_match(
    db: Session,
    *,
    candidate: bool = True,
    report_status: str = "MATCHED",
    days_after_loss: int = 10,
    found_area: str = "잠실",
    report_area: str = "잠실",
) -> tuple[FoundItem, LostReport, MatchCandidate | None]:
    now = datetime(2026, 1, 20, tzinfo=UTC)
    seed_user(db)
    item = seed_admin_found_item(db, area_name=found_area)
    item.found_at = now
    report = LostReport(id=20, user_id=2, object_class_id=1, colors=[], description="plain", area_name=report_area, lost_from=now - timedelta(days=days_after_loss), status=report_status, created_at=now, updated_at=now)
    db.add(report)
    match = None
    if candidate:
        time_score = 20 if days_after_loss <= 7 else 10
        area_score = 25 if found_area == report_area else 0
        match = MatchCandidate(id=50, lost_report_id=20, found_item_id=3, total_score=40 + area_score + time_score, type_score=40, area_score=area_score, time_score=time_score, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now)
        db.add(match)
    db.commit()
    return item, report, match


def test_admin_area_change_dismisses_candidate_below_threshold(client: TestClient, db: Session) -> None:
    seed_admin(db)
    _, report, candidate = seed_found_item_match(db, days_after_loss=10)
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"area_name": "부산"})

    assert response.status_code == 200
    assert candidate is not None and candidate.status == "DISMISSED"
    assert candidate.total_score == 50 and candidate.area_score == 0
    assert report.status == "OPEN"


def test_admin_area_change_dismisses_type_and_time_only_candidate(client: TestClient, db: Session) -> None:
    seed_admin(db)
    _, report, candidate = seed_found_item_match(db, days_after_loss=1)
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"area_name": "부산"})

    assert response.status_code == 200
    assert candidate is not None and candidate.status == "DISMISSED"
    assert candidate.total_score == 60 and candidate.area_score == 0
    assert report.status == "OPEN"


def test_admin_area_change_creates_new_candidate(client: TestClient, db: Session) -> None:
    seed_admin(db)
    _, report, _ = seed_found_item_match(db, candidate=False, report_status="OPEN", days_after_loss=10, found_area="부산", report_area="잠실")
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"area_name": "잠실"})

    assert response.status_code == 200
    candidates = db.query(MatchCandidate).filter_by(lost_report_id=20, found_item_id=3).all()
    assert len(candidates) == 1
    assert candidates[0].status == "NOTIFIED" and candidates[0].total_score == 75
    assert report.status == "MATCHED"


def test_admin_disposed_and_available_transitions_reconcile_existing_candidate(client: TestClient, db: Session) -> None:
    seed_admin(db)
    item, report, candidate = seed_found_item_match(db, days_after_loss=1)
    login(client)

    disposed = client.patch("/api/admin/found-items/3", json={"status": "DISPOSED"})
    assert disposed.status_code == 200
    assert candidate is not None and candidate.status == "DISMISSED"
    assert report.status == "OPEN"
    available = client.patch("/api/admin/found-items/3", json={"status": "AVAILABLE"})

    assert available.status_code == 200
    assert item.status == "AVAILABLE"
    assert candidate.status == "NOTIFIED"
    assert report.status == "MATCHED"
    assert db.query(MatchCandidate).filter_by(lost_report_id=20, found_item_id=3).count() == 1


def test_admin_disposed_keeps_report_matched_when_other_candidate_remains(client: TestClient, db: Session) -> None:
    seed_admin(db)
    _, report, candidate = seed_found_item_match(db, days_after_loss=1)
    other = FoundItem(id=4, object_class_id=1, source_type="ADMIN", area_name="잠실", found_at=datetime(2026, 1, 20, tzinfo=UTC), status="AVAILABLE", is_public=True, created_at=datetime(2026, 1, 20, tzinfo=UTC), updated_at=datetime(2026, 1, 20, tzinfo=UTC))
    db.add_all([other, MatchCandidate(id=51, lost_report_id=20, found_item_id=4, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=other.created_at, updated_at=other.updated_at)])
    db.commit()
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"status": "DISPOSED"})

    assert response.status_code == 200
    assert candidate is not None and candidate.status == "DISMISSED"
    assert report.status == "MATCHED"


@pytest.mark.parametrize("payload", [{"storage_location": "보관함 B"}, {"admin_memo": "상태 확인"}, {"area_name": "잠실"}])
def test_non_matching_or_unchanged_patch_skips_reconciliation(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, payload: dict[str, str]) -> None:
    seed_admin(db)
    _, _, candidate = seed_found_item_match(db, days_after_loss=1)
    login(client)
    calls = 0

    def reconcile_spy(session: Session, item: FoundItem) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(admin_api, "reconcile_match_candidates_for_found_item", reconcile_spy)

    response = client.patch("/api/admin/found-items/3", json=payload)

    assert response.status_code == 200
    assert calls == 0
    assert candidate is not None and (candidate.status, candidate.total_score, candidate.area_score) == ("NOTIFIED", 85, 25)


def test_admin_can_clear_found_item_storage_location(client: TestClient, db: Session) -> None:
    seed_admin(db)
    item = seed_admin_found_item(db)
    item.storage_location = "보관함 B"
    db.commit()
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"storage_location": ""})

    assert response.status_code == 200
    db.expire_all()
    assert db.get(FoundItem, 3).storage_location is None


def test_coordinate_change_runs_reconciliation(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    seed_found_item_match(db, days_after_loss=1)
    login(client)
    calls = 0

    def reconcile_spy(session: Session, item: FoundItem) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(admin_api, "reconcile_match_candidates_for_found_item", reconcile_spy)

    response = client.patch("/api/admin/found-items/3", json={"latitude": 37.1, "longitude": 127.1})

    assert response.status_code == 200
    assert calls == 1


def test_admin_coordinate_change_dismisses_far_candidate_and_restores_when_near(client: TestClient, db: Session) -> None:
    seed_admin(db)
    item, report, candidate = seed_found_item_match(db, days_after_loss=1)
    report.latitude = Decimal("37.0000")
    report.longitude = Decimal("127.0000")
    item.latitude = Decimal("37.0010")
    item.longitude = Decimal("127.0010")
    db.commit()
    login(client)

    far_response = client.patch("/api/admin/found-items/3", json={"latitude": 35.1796, "longitude": 129.0756})

    assert far_response.status_code == 200
    assert candidate is not None and candidate.status == "DISMISSED"
    assert report.status == "OPEN"
    near_response = client.patch("/api/admin/found-items/3", json={"latitude": 37.02, "longitude": 127.0})

    assert near_response.status_code == 200
    assert candidate.status == "NOTIFIED"
    assert candidate.area_score == 15 and candidate.total_score == 75
    assert report.status == "MATCHED"
    assert db.query(MatchCandidate).filter_by(lost_report_id=20, found_item_id=3).count() == 1


@pytest.mark.parametrize("claim_status", ["PENDING", "APPROVED"])
def test_active_claim_blocks_general_found_item_status_change(client: TestClient, db: Session, claim_status: str) -> None:
    seed_admin(db)
    item, _, candidate = seed_found_item_match(db, days_after_loss=1)
    item.status = "CLAIM_PENDING"
    assert candidate is not None
    candidate.status = "CLAIMED"
    db.add(OwnershipClaim(id=30, user_id=2, found_item_id=3, lost_report_id=20, verification_details="details", status=claim_status, created_at=item.created_at, updated_at=item.updated_at))
    db.commit()
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"status": "AVAILABLE"})

    assert response.status_code == 409
    db.refresh(item); db.refresh(candidate)
    assert item.status == "CLAIM_PENDING"
    assert candidate.status == "CLAIMED"
    assert db.get(OwnershipClaim, 30).status == claim_status


def test_active_claim_allows_location_edit_without_restoring_other_candidate(client: TestClient, db: Session) -> None:
    seed_admin(db)
    item, _, claimant = seed_found_item_match(db, days_after_loss=1)
    seed_user_two = User(id=3, email="other@example.com", password_hash="unused", nickname="other", role="USER", active=True, terms_agreed_at=item.created_at, privacy_agreed_at=item.created_at, created_at=item.created_at, updated_at=item.updated_at)
    other_report = LostReport(id=21, user_id=3, object_class_id=1, colors=[], description="plain", area_name="부산", lost_from=item.found_at - timedelta(days=1), status="OPEN", created_at=item.created_at, updated_at=item.updated_at)
    other_candidate = MatchCandidate(id=51, lost_report_id=21, found_item_id=3, total_score=60, type_score=40, area_score=0, time_score=20, keyword_score=0, status="DISMISSED", created_at=item.created_at, updated_at=item.updated_at)
    item.status = "CLAIM_PENDING"
    assert claimant is not None
    claimant.status = "CLAIMED"
    db.add_all([seed_user_two, other_report, other_candidate, OwnershipClaim(id=30, user_id=2, found_item_id=3, lost_report_id=20, verification_details="details", status="PENDING", created_at=item.created_at, updated_at=item.updated_at)])
    db.commit()
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"area_name": "부산", "latitude": 35.1, "longitude": 129.1})

    assert response.status_code == 200
    assert item.status == "CLAIM_PENDING"
    assert claimant.status == "CLAIMED"
    assert other_candidate.status == "DISMISSED"


def test_admin_reconciliation_never_reactivates_rejected_pair_but_restores_other_user(client: TestClient, db: Session) -> None:
    seed_admin(db)
    item, report_a, candidate_a = seed_found_item_match(db, days_after_loss=10, found_area="부산", report_area="잠실")
    now = item.created_at
    user_b = User(id=3, email="other@example.com", password_hash="unused", nickname="other", role="USER", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now)
    report_b = LostReport(id=21, user_id=3, object_class_id=1, colors=[], description="plain", area_name="잠실", lost_from=item.found_at - timedelta(days=10), status="OPEN", created_at=now, updated_at=now)
    assert candidate_a is not None
    candidate_a.status = "DISMISSED"
    db.add_all([user_b, report_b, OwnershipClaim(id=30, user_id=2, found_item_id=3, lost_report_id=20, verification_details="details", status="REJECTED", created_at=now, updated_at=now)])
    db.commit()
    login(client)

    response = client.patch("/api/admin/found-items/3", json={"area_name": "잠실"})

    assert response.status_code == 200
    assert candidate_a.status == "DISMISSED" and candidate_a.total_score == 75
    assert report_a.status == "OPEN"
    candidate_b = db.query(MatchCandidate).filter_by(lost_report_id=21, found_item_id=3).one()
    assert candidate_b.status == "NOTIFIED" and candidate_b.total_score == 75
    assert report_b.status == "MATCHED"


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

    saved = client.patch("/api/admin/detected-objects/10", json={"confirmed_color": "네이비"})
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
    assert db.query(Notification).filter_by(related_type="LOST_REPORT", related_id=promoted.id).count() == 1
    assert retained_candidate.total_score == 50 and retained_candidate.status == "DISMISSED"
    assert claimed_candidate.total_score == 50 and claimed_candidate.status == "CLAIMED"

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()
    assert db.query(MatchCandidate).filter_by(lost_report_id=81, found_item_id=80).count() == 1
    assert db.query(Notification).filter_by(related_type="LOST_REPORT", related_id=promoted.id).count() == 1


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


@pytest.mark.parametrize(("found_status", "is_public"), [("CLAIM_PENDING", True), ("RETURNED", True), ("AVAILABLE", False)])
def test_reconcile_non_matchable_found_item_creates_no_candidate_or_notification(db: Session, found_status: str, is_public: bool) -> None:
    seed_admin(db)
    now = datetime(2026, 1, 20, tzinfo=UTC)
    found = FoundItem(id=100, object_class_id=1, source_type="ADMIN", color="red", area_name="found-area", found_at=now, status=found_status, is_public=is_public, created_at=now, updated_at=now)
    report = LostReport(id=101, user_id=1, object_class_id=1, color="red", colors=["red"], description="plain", area_name="lost-area", lost_from=now - timedelta(days=10), status="OPEN", created_at=now, updated_at=now)
    db.add_all([found, report]); db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()

    assert db.query(MatchCandidate).filter_by(found_item_id=100).count() == 0
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND").count() == 0


def test_reconcile_non_matchable_found_item_preserves_claimed_candidate(db: Session) -> None:
    seed_admin(db)
    now = datetime(2026, 1, 20, tzinfo=UTC)
    found = FoundItem(id=110, object_class_id=1, source_type="ADMIN", color="red", area_name="found-area", found_at=now, status="CLAIM_PENDING", is_public=True, created_at=now, updated_at=now)
    report = LostReport(id=111, user_id=1, object_class_id=1, color="blue", colors=["blue"], description="plain", area_name="lost-area", lost_from=now - timedelta(days=10), status="CLAIM_PENDING", created_at=now, updated_at=now)
    candidate = MatchCandidate(lost_report_id=111, found_item_id=110, total_score=60, type_score=40, area_score=0, time_score=10, keyword_score=10, status="CLAIMED", created_at=now, updated_at=now)
    claim = OwnershipClaim(id=112, user_id=1, lost_report_id=111, found_item_id=110, verification_details="ownership details", status="PENDING", created_at=now, updated_at=now)
    db.add_all([found, report, candidate, claim]); db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()

    assert candidate.status == "CLAIMED"
    assert candidate.total_score == 60
    assert db.get(OwnershipClaim, 112).status == "PENDING"
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND").count() == 0


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


def test_mobile_waste_registration_requires_admin(client: TestClient, db: Session) -> None:
    response = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(), files=mobile_waste_files())
    assert response.status_code == 401

    seed_user(db); login_user(client)
    forbidden = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(), files=mobile_waste_files())
    assert forbidden.status_code == 403


def test_mobile_waste_registration_rejects_invalid_camera(client: TestClient, db: Session) -> None:
    seed_admin(db); login(client)
    response = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(camera_id=999), files=mobile_waste_files())
    assert response.status_code == 422
    assert db.query(DetectionEvent).count() == 0
    assert db.query(DetectedObject).count() == 0


def test_mobile_waste_registration_saves_only_selected_trash_and_collects(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "UPLOAD_DIR", str(tmp_path / "uploads"))
    seed_admin(db); seed_mobile_waste_prerequisites(db); login(client)
    override_mobile_waste_inference(DetectionInferenceResult(
        media_width=160,
        media_height=120,
        detections=[
            DetectionPrediction(class_code="BAG", confidence=.99, bbox=DetectionBBox(x=70, y=20, width=35, height=35)),
            DetectionPrediction(class_code="TRASH", confidence=.87, bbox=DetectionBBox(x=10, y=12, width=40, height=32)),
            DetectionPrediction(class_code="TRASH", confidence=.78, bbox=DetectionBBox(x=100, y=50, width=30, height=28)),
        ],
    ))

    response = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(), files=mobile_waste_files())

    assert response.status_code == 201
    body = response.json()
    assert body["processing_status"] == "CONFIRMED"
    assert body["follow_up_kind"] == "WASTE"
    assert body["waste_collection_completed"] is False
    assert body["original_media_url"].startswith("detections/user/1/")
    assert body["cropped_image_url"].endswith("-crop.jpg")
    assert db.query(DetectionEvent).count() == 1
    assert db.query(DetectedObject).count() == 1
    item = db.query(DetectedObject).one()
    assert item.object_class.code == "TRASH"
    assert item.final_class_code == "TRASH"
    assert item.processing_status == "CONFIRMED"
    assert item.confidence == Decimal("0.87")
    assert db.query(ProcessingHistory).filter_by(entity_type="DETECTED_OBJECT", entity_id=item.id, action_type="DETECTED_OBJECT_REVIEWED").count() == 1
    upload_root = tmp_path / "uploads"
    assert (upload_root / body["original_media_url"]).exists()
    assert (upload_root / body["cropped_image_url"]).exists()

    listed = client.get("/api/admin/detections").json()[0]["detected_objects"][0]
    assert listed["follow_up_kind"] == "WASTE"
    assert listed["waste_collection_completed"] is False

    collected = client.post(f"/api/admin/detected-objects/{item.id}/collect")
    assert collected.status_code == 200
    assert collected.json()["waste_collection_completed"] is True
    assert db.query(ProcessingHistory).filter_by(entity_type="DETECTED_OBJECT", entity_id=item.id, action_type="WASTE_COLLECTION_COMPLETED").count() == 1
    assert client.post(f"/api/admin/detected-objects/{item.id}/collect").status_code == 409


def test_mobile_waste_registration_rejects_personal_item_only_and_cleans_file(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "UPLOAD_DIR", str(tmp_path / "uploads"))
    seed_admin(db); seed_mobile_waste_prerequisites(db); login(client)
    override_mobile_waste_inference(DetectionInferenceResult(
        media_width=160,
        media_height=120,
        detections=[DetectionPrediction(class_code="BAG", confidence=.92, bbox=DetectionBBox(x=10, y=12, width=40, height=32))],
    ))

    response = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(), files=mobile_waste_files())

    assert response.status_code == 422
    assert db.query(DetectionEvent).count() == 0
    assert db.query(DetectedObject).count() == 0
    assert not list((tmp_path / "uploads").glob("detections/user/1/*"))


def test_mobile_waste_registration_rejects_low_iou_and_invalid_file(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "UPLOAD_DIR", str(tmp_path / "uploads"))
    seed_admin(db); seed_mobile_waste_prerequisites(db); login(client)
    override_mobile_waste_inference(DetectionInferenceResult(
        media_width=160,
        media_height=120,
        detections=[DetectionPrediction(class_code="TRASH", confidence=.82, bbox=DetectionBBox(x=90, y=70, width=30, height=25))],
    ))

    low_iou = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(), files=mobile_waste_files())
    invalid_type = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(), files=mobile_waste_files(content=b"text", content_type="text/plain"))

    assert low_iou.status_code == 422
    assert invalid_type.status_code == 415
    assert db.query(DetectionEvent).count() == 0
    assert db.query(DetectedObject).count() == 0
    assert not list((tmp_path / "uploads").glob("detections/user/1/*"))


def test_mobile_waste_registration_clamps_server_prediction_bbox_and_stores_matching_crop(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "UPLOAD_DIR", str(tmp_path / "uploads"))
    seed_admin(db); seed_mobile_waste_prerequisites(db); login(client)
    override_mobile_waste_inference(DetectionInferenceResult(
        media_width=160,
        media_height=120,
        detections=[DetectionPrediction(class_code="TRASH", confidence=.91, bbox=DetectionBBox(x=10, y=12, width=155, height=110))],
    ))

    response = client.post(
        "/api/admin/detections/mobile-waste",
        data=mobile_waste_form(x=10, y=12, width=150, height=108),
        files=mobile_waste_files(),
    )

    assert response.status_code == 201
    item = db.query(DetectedObject).one()
    assert item.bbox_x == Decimal("10.0000")
    assert item.bbox_y == Decimal("12.0000")
    assert item.bbox_width == Decimal("150.0000")
    assert item.bbox_height == Decimal("108.0000")
    body = response.json()
    upload_root = tmp_path / "uploads"
    assert (upload_root / body["original_media_url"]).exists()
    assert (upload_root / body["cropped_image_url"]).exists()


@pytest.mark.parametrize(
    "bbox",
    [
        DetectionBBox(x=200, y=50, width=20, height=20),
        DetectionBBox(x=10, y=12, width=float("nan"), height=32),
        DetectionBBox(x=10, y=12, width=float("inf"), height=32),
        DetectionBBox(x=10, y=12, width=-10, height=32),
    ],
)
def test_mobile_waste_registration_rejects_invalid_server_prediction_bbox_and_cleans_file(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    bbox: DetectionBBox,
) -> None:
    monkeypatch.setattr(get_settings(), "UPLOAD_DIR", str(tmp_path / "uploads"))
    seed_admin(db); seed_mobile_waste_prerequisites(db); login(client)
    override_mobile_waste_inference(DetectionInferenceResult(
        media_width=160,
        media_height=120,
        detections=[DetectionPrediction(class_code="TRASH", confidence=.82, bbox=bbox)],
    ))

    response = client.post("/api/admin/detections/mobile-waste", data=mobile_waste_form(), files=mobile_waste_files())

    assert response.status_code == 422
    assert db.query(DetectionEvent).count() == 0
    assert db.query(DetectedObject).count() == 0
    assert not list((tmp_path / "uploads").glob("detections/user/1/*"))


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
    assert events == []
    assert client.patch("/api/admin/detected-objects/10", json={"processing_status": "CONFIRMED"}).status_code == 404
    assert client.post("/api/admin/detected-objects/10/found-item").status_code == 409
    assert client.post("/api/admin/detected-objects/30/collect").status_code == 409
    assert db.query(FoundItem).count() == 0
    assert db.query(ProcessingHistory).filter_by(action_type="WASTE_COLLECTION_COMPLETED").count() == 0


def test_admin_detection_list_excludes_user_analysis_media_urls(client: TestClient, db: Session) -> None:
    seed_admin(db)
    now = datetime(2026, 1, 2, tzinfo=UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=now, purpose="OPERATION")
    seed_detection(db, object_id=11, event_id=21, detected_at=now, purpose="USER_ANALYSIS")
    db.get(DetectionEvent, 21).original_media_url = "/uploads/user-analysis-original.jpg"
    db.get(DetectionEvent, 21).result_media_url = "/uploads/user-analysis-result.jpg"
    db.get(DetectedObject, 11).cropped_image_url = "/uploads/user-analysis-crop.jpg"
    db.commit(); login(client)

    response = client.get("/api/admin/detections")

    assert response.status_code == 200
    body = response.json()
    assert [event["purpose"] for event in body] == ["OPERATION"]
    payload = str(body)
    assert "user-analysis-original" not in payload
    assert "user-analysis-result" not in payload
    assert "user-analysis-crop" not in payload


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
    assert body["metrics"]["operation_detection_pending"] == 0


def test_dashboard_operation_pending_counts_only_operation_pending_objects(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=fixed_now, purpose="OPERATION", processing_status="PENDING")
    seed_detection(db, object_id=11, event_id=21, detected_at=fixed_now, purpose="USER_ANALYSIS", processing_status="PENDING")
    seed_detection(db, object_id=12, event_id=22, detected_at=fixed_now, purpose="OPERATION", processing_status="CONFIRMED")
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    assert response.json()["metrics"]["operation_detection_pending"] == 1


def test_dashboard_waste_pending_counts_confirmed_operation_waste_without_collection_history(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_waste_detection(db, object_id=30, event_id=40, processing_status="PENDING")
    seed_waste_detection(db, object_id=31, event_id=41, processing_status="CONFIRMED")
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    metrics = response.json()["metrics"]
    assert metrics["operation_detection_pending"] == 1
    assert metrics["waste_collection_pending"] == 1


def test_dashboard_waste_collection_history_excludes_object_from_pending_metric(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_waste_detection(db, object_id=30, event_id=40, processing_status="CONFIRMED")
    db.add(ProcessingHistory(actor_user_id=1, entity_type="DETECTED_OBJECT", entity_id=30, action_type="WASTE_COLLECTION_COMPLETED", previous_status="CONFIRMED", new_status="CONFIRMED", created_at=fixed_now))
    db.commit()
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    assert response.json()["metrics"]["waste_collection_pending"] == 0


def test_dashboard_waste_pending_excludes_user_analysis_personal_and_natural_objects(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_waste_detection(db, object_id=30, event_id=40, processing_status="CONFIRMED")
    db.get(DetectionEvent, 40).purpose = "USER_ANALYSIS"
    seed_detection(db, object_id=31, event_id=41, detected_at=fixed_now, purpose="OPERATION", processing_status="CONFIRMED")
    db.add(ObjectClass(id=3, code="BRANCH", name_ko="나뭇가지", group_code="NATURAL", display_order=3, is_active=True, created_at=fixed_now, updated_at=fixed_now))
    db.add(DetectionEvent(id=42, camera_id=1, purpose="OPERATION", source_type="IMAGE", original_media_url="/uploads/natural.jpg", status="COMPLETED", captured_at=fixed_now, created_at=fixed_now, updated_at=fixed_now))
    db.add(DetectedObject(id=32, detection_event_id=42, object_class_id=3, processing_status="CONFIRMED", confidence=Decimal("0.9"), bbox_x=Decimal("1"), bbox_y=Decimal("2"), bbox_width=Decimal("30"), bbox_height=Decimal("40"), cropped_image_url=None, appearance_count=1, detected_at=fixed_now, created_at=fixed_now))
    db.commit()
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    assert response.json()["metrics"]["waste_collection_pending"] == 0


def test_dashboard_waste_pending_uses_final_classification_group(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=fixed_now, purpose="OPERATION", processing_status="CONFIRMED")
    db.add(ObjectClass(id=2, code="TRASH", name_ko="쓰레기", group_code="WASTE", display_order=2, is_active=True, created_at=fixed_now, updated_at=fixed_now))
    db.get(DetectedObject, 10).final_class_code = "TRASH"
    db.commit()
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    assert response.json()["metrics"]["waste_collection_pending"] == 1


def test_dashboard_waste_pending_excludes_object_reclassified_to_personal_item(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_waste_detection(db, object_id=30, event_id=40, processing_status="CONFIRMED")
    db.add(ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=fixed_now, updated_at=fixed_now))
    db.get(DetectedObject, 30).final_class_code = "BAG"
    db.commit()
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    assert response.json()["metrics"]["waste_collection_pending"] == 0


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


def test_dashboard_recent_detections_exclude_user_analysis(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_admin(db)
    fixed_now = datetime(2026, 1, 2, 3, tzinfo=UTC)
    seed_detection(db, object_id=10, event_id=20, detected_at=fixed_now, purpose="OPERATION")
    seed_detection(db, object_id=11, event_id=21, detected_at=fixed_now + timedelta(minutes=1), purpose="USER_ANALYSIS")
    monkeypatch.setattr(admin_api, "utc_now", lambda: fixed_now)
    login(client)

    response = client.get("/api/admin/dashboard", params={"period": "today"})

    assert response.status_code == 200
    assert [item["detection_event_id"] for item in response.json()["recent_detections"]] == [20]
