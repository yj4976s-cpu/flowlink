from __future__ import annotations

from collections.abc import Iterator
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.detections import get_inference_service
from app.core.config import get_settings
from app.core.security import create_access_token, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import DetectedObject, DetectionEvent, ObjectClass, User, VideoJob
from app.services.detection_inference import DetectionBBox, DetectionInferenceResult, DetectionInferenceService, DetectionPrediction


@compiles(BigInteger, "sqlite")
def compile_big_integer_for_sqlite(_type, _compiler, **_kwargs) -> str:
    return "INTEGER"


class MockInferenceService(DetectionInferenceService):
    def __init__(self, result: DetectionInferenceResult) -> None:
        self.result = result

    def analyze_image(self, media_path: Path) -> DetectionInferenceResult:
        assert media_path.exists()
        return self.result

    def analyze_video(self, media_path: Path) -> DetectionInferenceResult:
        assert media_path.exists()
        return self.result


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, class_=Session, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client(db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        yield db

    settings = get_settings()
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def seed_user(db: Session, user_id: int, *, role: str = "USER") -> User:
    now = utc_now()
    user = User(
        id=user_id,
        email=f"user{user_id}@example.com",
        password_hash="not-used",
        nickname=f"user{user_id}",
        role=role,
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.commit()
    return user


def seed_object_class(db: Session, class_id: int, code: str, *, active: bool = True, group_code: str = "PERSONAL_ITEM") -> None:
    now = utc_now()
    db.add(
        ObjectClass(
            id=class_id,
            code=code,
            name_ko=code,
            group_code=group_code,
            display_order=class_id,
            is_active=active,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()


def authenticate(client: TestClient, user: User) -> None:
    token, _ = create_access_token(user.id, user.role)
    client.cookies.set(get_settings().AUTH_COOKIE_NAME, token)


def override_inference(result: DetectionInferenceResult) -> None:
    app.dependency_overrides[get_inference_service] = lambda: MockInferenceService(result)


def image_file(content: bytes = b"image-bytes") -> dict[str, tuple[str, BytesIO, str]]:
    return {"file": ("sample.jpg", BytesIO(content), "image/jpeg")}


def test_detection_endpoints_require_authentication(client: TestClient) -> None:
    response = client.post("/api/detections/images", files=image_file())

    assert response.status_code == 401


@pytest.mark.parametrize("role", ["USER", "ADMIN"])
def test_image_detection_is_allowed_for_user_and_admin(client: TestClient, db: Session, role: str) -> None:
    user = seed_user(db, 1, role=role)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    override_inference(
        DetectionInferenceResult(
            media_width=640,
            media_height=480,
            detections=[
                DetectionPrediction(
                    class_code="bag",
                    confidence=0.92,
                    bbox=DetectionBBox(x=10, y=20, width=100, height=120),
                )
            ],
        )
    )

    response = client.post("/api/detections/images", files=image_file(), data={"purpose": "OPERATION"})

    assert response.status_code == 201
    body = response.json()
    assert body["purpose"] == "USER_ANALYSIS"
    assert body["status"] == "COMPLETED"
    assert body["media_width"] == 640
    assert body["detected_objects"][0]["class_code"] == "BAG"
    event = db.query(DetectionEvent).one()
    assert event.user_id == user.id
    assert event.purpose == "USER_ANALYSIS"


def test_default_inference_unavailable_returns_503_and_failed_event(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)

    response = client.post("/api/detections/images", files=image_file())

    assert response.status_code == 503
    event = db.query(DetectionEvent).one()
    assert event.status == "FAILED"
    assert event.error_message == "AI detection model is not configured"


def test_user_can_only_list_own_user_analysis_events(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    other = seed_user(db, 2)
    now = utc_now()
    db.add_all(
        [
            DetectionEvent(
                id=10,
                user_id=user.id,
                purpose="USER_ANALYSIS",
                source_type="IMAGE",
                original_media_url="detections/user/1/a.jpg",
                status="COMPLETED",
                captured_at=now,
                created_at=now,
                updated_at=now,
            ),
            DetectionEvent(
                id=11,
                user_id=other.id,
                purpose="USER_ANALYSIS",
                source_type="IMAGE",
                original_media_url="detections/user/2/a.jpg",
                status="COMPLETED",
                captured_at=now,
                created_at=now,
                updated_at=now,
            ),
            DetectionEvent(
                id=12,
                user_id=user.id,
                purpose="OPERATION",
                source_type="IMAGE",
                original_media_url="operation/a.jpg",
                status="COMPLETED",
                captured_at=now,
                created_at=now,
                updated_at=now,
            ),
        ]
    )
    db.commit()
    authenticate(client, user)

    list_response = client.get("/api/detections/me")
    own_detail = client.get("/api/detections/10")
    other_detail = client.get("/api/detections/11")
    operation_detail = client.get("/api/detections/12")

    assert list_response.status_code == 200
    assert [event["id"] for event in list_response.json()] == [10]
    assert own_detail.status_code == 200
    assert other_detail.status_code == 404
    assert operation_detail.status_code == 404


def test_upload_validation_rejects_empty_unsupported_and_oversized_files(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)

    empty_response = client.post("/api/detections/images", files=image_file(b""))
    unsupported_response = client.post(
        "/api/detections/images",
        files={"file": ("sample.txt", BytesIO(b"text"), "text/plain")},
    )
    oversized_response = client.post("/api/detections/images", files=image_file(b"x" * (20 * 1024 * 1024 + 1)))

    assert empty_response.status_code == 400
    assert unsupported_response.status_code == 415
    assert oversized_response.status_code == 413


def test_video_detection_creates_video_job(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    override_inference(DetectionInferenceResult(media_width=None, media_height=None, detections=[]))

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 201
    assert response.json()["status"] == "COMPLETED"
    event = db.query(DetectionEvent).one()
    assert event.status == "COMPLETED"
    job = db.query(VideoJob).one()
    assert job.detection_event_id == response.json()["id"]
    assert job.status == "COMPLETED"
    assert job.processing_progress == 100
    assert job.processing_completed_at is not None
    assert job.error_message is None


def test_zero_detection_is_completed_without_objects(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    override_inference(DetectionInferenceResult(media_width=320, media_height=240, detections=[]))

    response = client.post("/api/detections/images", files=image_file())

    assert response.status_code == 201
    assert response.json()["status"] == "COMPLETED"
    assert response.json()["detected_objects"] == []
    assert db.query(DetectedObject).count() == 0
    assert db.query(VideoJob).count() == 0


def test_unknown_or_inactive_class_fails_without_unknown_fallback(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "UNKNOWN", group_code="UNKNOWN")
    authenticate(client, user)
    override_inference(
        DetectionInferenceResult(
            media_width=320,
            media_height=240,
            detections=[
                DetectionPrediction(
                    class_code="UNKNOWN",
                    confidence=0.9,
                    bbox=DetectionBBox(x=0, y=0, width=10, height=10),
                )
            ],
        )
    )

    response = client.post("/api/detections/images", files=image_file())

    assert response.status_code == 500
    assert db.query(DetectionEvent).one().status == "FAILED"
    assert db.query(DetectedObject).count() == 0


def test_partial_object_save_failure_does_not_leave_completed_partial_rows(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    override_inference(
        DetectionInferenceResult(
            media_width=320,
            media_height=240,
            detections=[
                DetectionPrediction(
                    class_code="BAG",
                    confidence=0.9,
                    bbox=DetectionBBox(x=0, y=0, width=10, height=10),
                )
            ],
        )
    )

    def fail_complete(*args, **kwargs):
        session = args[0]
        for detected_object in kwargs["objects"]:
            session.add(detected_object)
        session.flush()
        raise RuntimeError("db failed")

    monkeypatch.setattr("app.services.detections.complete_detection_event", fail_complete)

    response = client.post("/api/detections/images", files=image_file())

    assert response.status_code == 500
    assert db.query(DetectionEvent).one().status == "FAILED"
    assert db.query(DetectedObject).count() == 0
