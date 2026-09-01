from __future__ import annotations

import subprocess
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.detections import get_inference_service
from app.core.config import get_settings
from app.core.security import create_access_token, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import Camera, DetectedObject, DetectionEvent, Notification, ObjectClass, User, VideoJob
from app.services.ai_inference_client import (
    AIInferenceBBox,
    AIInferencePrediction,
    AIInferenceResult,
    AIInferenceVideoResult,
    AIInferenceVideoTrack,
)
from app.services.detection_inference import (
    DetectionBBox,
    DetectionInferenceResult,
    DetectionInferenceService,
    DetectionInferenceUnavailableError,
    DetectionPrediction,
    model_label_to_class_code,
)
from app.services.detection_notifications import (
    SAFE_VIDEO_TIMEOUT_MESSAGE,
    VIDEO_TIMEOUT_ERROR_CODE,
    ensure_detection_terminal_notification,
    is_video_timeout_error,
)
from app.services.user_analysis_reports import KST, analysis_period_window, build_user_analysis_summary
from app.services.webcam_inference import (
    WebcamDetectionFrame,
    WebcamDetectionObject,
    WebcamInferenceService,
    WebcamInferenceUnavailableError,
    get_webcam_inference_service,
)
from app.services.user_media_uploads import _run_command, validate_video_probe
from app.repositories.detections import claim_next_queued_video_job, fail_detection_event
from app.workers.video_detection_worker import fail_stale_jobs, process_one_job


@compiles(BigInteger, "sqlite")
def compile_big_integer_for_sqlite(_type, _compiler, **_kwargs) -> str:
    return "INTEGER"


class MockInferenceService(DetectionInferenceService):
    def __init__(self, result: DetectionInferenceResult) -> None:
        self.result = result

    def analyze_image(self, media_path: Path) -> DetectionInferenceResult:
        assert media_path.exists()
        return self.result

    def analyze_video(self, media_path: Path, *, video_job_id: int | None = None) -> DetectionInferenceResult:
        assert media_path.exists()
        assert video_job_id is not None
        return self.result


class MockWebcamInferenceService(WebcamInferenceService):
    def __init__(self, result: WebcamDetectionFrame | Exception) -> None:
        self.result = result

    def analyze_frame(self, image: Image.Image) -> WebcamDetectionFrame:
        if isinstance(self.result, Exception):
            raise self.result
        return WebcamDetectionFrame(
            media_width=image.width,
            media_height=image.height,
            inference_ms=self.result.inference_ms,
            detected_objects=self.result.detected_objects,
        )


class FakeAIInferenceClient:
    def __init__(self, result: AIInferenceResult, video_result: AIInferenceVideoResult | None = None) -> None:
        self.result = result
        self.video_result = video_result
        self.file_calls = 0
        self.video_file_calls = 0
        self.video_job_ids: list[int | None] = []
        self.image_calls = 0

    def infer_image_file(self, media_path: Path) -> AIInferenceResult:
        self.file_calls += 1
        assert media_path.exists()
        return self.result

    def infer_video_file(self, media_path: Path, *, video_job_id: int | None = None) -> AIInferenceVideoResult:
        self.video_file_calls += 1
        self.video_job_ids.append(video_job_id)
        assert media_path.exists()
        assert self.video_result is not None
        return self.video_result

    def infer_image(self, image: Image.Image) -> AIInferenceResult:
        self.image_calls += 1
        assert image.mode == "RGB"
        return AIInferenceResult(
            model_id=self.result.model_id,
            media_width=image.width,
            media_height=image.height,
            inference_ms=self.result.inference_ms,
            predictions=self.result.predictions,
        )


class FailingAIInferenceClient:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def infer_image_file(self, media_path: Path) -> AIInferenceResult:
        raise self.error

    def infer_video_file(self, media_path: Path, *, video_job_id: int | None = None) -> AIInferenceVideoResult:
        raise self.error

    def infer_image(self, image: Image.Image) -> AIInferenceResult:
        raise self.error


@pytest.mark.parametrize(
    ("model_label", "expected"),
    [
        ("BRANCH", "BRANCH"),
        ("branch", "BRANCH"),
        ("AQUATIC_PLANT", "AQUATIC_PLANT"),
        ("aquatic_plant", "AQUATIC_PLANT"),
        ("aquatic plant", "AQUATIC_PLANT"),
        ("HAT", "HAT"),
        ("hat", "HAT"),
    ],
)
def test_flowlink_custom_model_labels_map_directly(model_label: str, expected: str) -> None:
    assert model_label_to_class_code(model_label) == expected


@pytest.mark.parametrize("model_label", ["shoe", "sneaker", "footwear"])
def test_footwear_model_labels_map_to_footwear(model_label: str) -> None:
    assert model_label_to_class_code(model_label) == "FOOTWEAR"


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

    async def fake_save_user_video_upload(upload, *, current_user, upload_root, settings):
        suffix = ".mp4"
        relative_key = Path("detections") / "user" / str(current_user.id) / f"{uuid4().hex}{suffix}"
        destination = upload_root / relative_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        payload = await upload.read()
        destination.write_bytes(payload or b"raw-video")
        return destination, relative_key.as_posix(), destination.stat().st_size

    def fake_validate_saved_user_video(media_path: Path, *, settings):
        return None

    def fake_normalize_user_video_in_place(media_path: Path, *, settings):
        media_path.write_bytes(b"normalized-video")
        return media_path.stat().st_size

    monkeypatch.setattr("app.api.detections.save_user_video_upload", fake_save_user_video_upload)
    monkeypatch.setattr("app.api.detections.validate_saved_user_video", fake_validate_saved_user_video)
    monkeypatch.setattr("app.workers.video_detection_worker.normalize_user_video_in_place", fake_normalize_user_video_in_place)
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


def override_webcam_inference(result: WebcamDetectionFrame | Exception) -> None:
    app.dependency_overrides[get_webcam_inference_service] = lambda: MockWebcamInferenceService(result)


def image_file(content: bytes | None = None) -> dict[str, tuple[str, BytesIO, str]]:
    return {"file": ("sample.jpg", BytesIO(jpeg_payload() if content is None else content), "image/jpeg")}


def jpeg_payload(*, width: int = 64, height: int = 48) -> bytes:
    payload = BytesIO()
    Image.new("RGB", (width, height), color=(28, 92, 160)).save(payload, format="JPEG")
    return payload.getvalue()


def webcam_file(content: bytes | None = None, content_type: str = "image/jpeg") -> dict[str, tuple[str, BytesIO, str]]:
    return {"file": ("webcam-frame.jpg", BytesIO(jpeg_payload() if content is None else content), content_type)}


def test_detection_endpoints_require_authentication(client: TestClient) -> None:
    response = client.post("/api/detections/images", files=image_file())
    webcam_response = client.post("/api/detections/webcam/frame", files=webcam_file())

    assert response.status_code == 401
    assert webcam_response.status_code == 401


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


def test_admin_operation_detection_requires_camera_and_stays_separate_from_user_analysis(client: TestClient, db: Session) -> None:
    admin = seed_user(db, 1, role="ADMIN")
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    db.add(Camera(id=1, code="DEMO", name="발표 카메라", area_name="서울시청", latitude=Decimal("37.566295"), longitude=Decimal("126.977945"), is_active=True, created_at=now, updated_at=now))
    db.commit(); authenticate(client, admin)
    override_inference(DetectionInferenceResult(media_width=640, media_height=480, detections=[DetectionPrediction(class_code="bag", confidence=.92, bbox=DetectionBBox(x=10, y=20, width=100, height=120))]))
    response = client.post("/api/admin/detections/images", files=image_file(jpeg_payload(width=640, height=480)), data={"camera_id": "1"})
    assert response.status_code == 200
    event = db.query(DetectionEvent).one()
    assert event.purpose == "OPERATION"
    assert event.camera_id == 1
    assert event.user_id == admin.id
    assert event.detected_objects[0].processing_status == "PENDING"
    assert event.detected_objects[0].ai_color in {"파랑", "진파랑"}


def test_default_image_inference_uses_backend_ai_client(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    fake_client = FakeAIInferenceClient(
        AIInferenceResult(
            model_id="flowlink-4class-hat-v7",
            media_width=80,
            media_height=60,
            inference_ms=18.2,
            predictions=[
                AIInferencePrediction(
                    model_label="backpack",
                    confidence=0.87,
                    bbox=AIInferenceBBox(x=4, y=5, width=20, height=22),
                )
            ],
        )
    )
    app.dependency_overrides[get_inference_service] = lambda: DetectionInferenceService(ai_client=fake_client)

    response = client.post("/api/detections/images", files=image_file(jpeg_payload(width=80, height=60)))

    assert response.status_code == 201
    assert fake_client.file_calls == 1
    body = response.json()
    assert body["status"] == "COMPLETED"
    assert body["ai_model_id"] == "flowlink-4class-hat-v7"
    assert body["media_width"] == 80
    assert body["media_height"] == 60
    assert body["detected_objects"][0]["class_code"] == "BAG"
    assert body["detected_objects"][0]["confidence"] == 0.87
    assert db.query(DetectionEvent).one().ai_model_id == "flowlink-4class-hat-v7"


def test_default_video_inference_uses_backend_ai_client_and_preserves_tracks(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "FOOTWEAR")
    seed_object_class(db, 2, "BALL")
    seed_object_class(db, 3, "TRASH", group_code="WASTE")
    authenticate(client, user)
    fake_client = FakeAIInferenceClient(
        AIInferenceResult(media_width=1, media_height=1, inference_ms=0, predictions=[]),
        video_result=AIInferenceVideoResult(
            model_id="flowlink-4class-hat-v7",
            media_width=640,
            media_height=360,
            duration_ms=2800,
            frame_count=84,
            fps=30,
            inference_ms=91.4,
            rendered_video=b"rendered-video",
            tracks=[
                AIInferenceVideoTrack(
                    model_label="shoe",
                    confidence=0.88,
                    bbox=AIInferenceBBox(x=10, y=20, width=100, height=120),
                    track_id=4,
                    first_seen_ms=133,
                    last_seen_ms=2200,
                    appearance_count=41,
                ),
                AIInferenceVideoTrack(
                    model_label="ball",
                    confidence=0.77,
                    bbox=AIInferenceBBox(x=210, y=80, width=40, height=42),
                    track_id=9,
                    first_seen_ms=0,
                    last_seen_ms=900,
                    appearance_count=18,
                ),
                AIInferenceVideoTrack(
                    model_label="trash",
                    confidence=0.66,
                    bbox=AIInferenceBBox(x=300, y=120, width=30, height=33),
                    track_id=None,
                    first_seen_ms=400,
                    last_seen_ms=700,
                    appearance_count=3,
                ),
            ],
        ),
    )
    app.dependency_overrides[get_inference_service] = lambda: DetectionInferenceService(ai_client=fake_client)

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 202
    assert fake_client.video_file_calls == 0
    body = response.json()
    assert body["status"] == "PROCESSING"
    assert body["stage"] == "QUEUED"
    event = db.query(DetectionEvent).one()
    job = db.query(VideoJob).one()
    assert event.status == "PROCESSING"
    assert event.result_media_url is None
    assert job.status == "PROCESSING"
    assert job.processing_stage == "QUEUED"
    assert job.processing_progress == 0

    assert process_one_job(db, inference_service=DetectionInferenceService(ai_client=fake_client)) is True
    assert fake_client.video_job_ids == [job.id]
    db.expire_all()
    event = db.query(DetectionEvent).one()
    job = db.query(VideoJob).one()
    assert event.status == "COMPLETED"
    assert event.ai_model_id == "flowlink-4class-hat-v7"
    assert event.result_media_url is not None
    assert event.result_media_url.endswith("-result.mp4")
    assert [item.object_class.code for item in event.detected_objects] == ["FOOTWEAR", "BALL", "TRASH"]
    assert event.detected_objects[0].track_id == 4
    assert event.detected_objects[0].first_seen_ms == 133
    assert event.detected_objects[0].last_seen_ms == 2200
    assert event.detected_objects[0].appearance_count == 41
    assert job.status == "COMPLETED"
    assert job.processing_stage == "COMPLETED"
    assert job.processing_progress == 100
    notification = db.query(Notification).one()
    assert notification.notification_type == "DETECTION_COMPLETED"
    assert notification.related_type == "DETECTION_EVENT"
    assert notification.related_id == event.id
    assert "3" in notification.message
    assert "secret" not in notification.message
    assert ".pt" not in notification.message


def test_video_detection_validates_saved_video_through_threadpool(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    override_inference(DetectionInferenceResult(media_width=320, media_height=180, detections=[], rendered_video=b"rendered"))
    called = {"value": False}

    async def fake_run_in_threadpool(func, *args, **kwargs):
        called["value"] = True
        return func(*args, **kwargs)

    monkeypatch.setattr("app.api.detections.run_in_threadpool", fake_run_in_threadpool)

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 202
    assert called["value"] is True
    assert response.json()["stage"] == "QUEUED"


def test_webcam_inference_uses_backend_ai_client() -> None:
    fake_client = FakeAIInferenceClient(
        AIInferenceResult(
            media_width=32,
            media_height=24,
            inference_ms=7.5,
            predictions=[
                AIInferencePrediction(
                    model_label="umbrella",
                    confidence=0.81,
                    bbox=AIInferenceBBox(x=1, y=2, width=3, height=4),
                )
            ],
        )
    )
    service = WebcamInferenceService(ai_client=fake_client)

    result = service.analyze_frame(Image.new("RGB", (32, 24), color=(1, 2, 3)))

    assert fake_client.image_calls == 1
    assert result.media_width == 32
    assert result.media_height == 24
    assert result.inference_ms == 7.5
    assert result.detected_objects[0].label == "umbrella"
    assert result.detected_objects[0].class_code == "UMBRELLA"
    assert result.detected_objects[0].class_name_ko == "우산"
    assert result.detected_objects[0].group_code == "PERSONAL_ITEM"


def test_webcam_inference_maps_business_classes_and_keeps_unknown_safe() -> None:
    fake_client = FakeAIInferenceClient(
        AIInferenceResult(
            media_width=32,
            media_height=24,
            inference_ms=7.5,
            predictions=[
                AIInferencePrediction(
                    model_label="shoe",
                    confidence=0.82,
                    bbox=AIInferenceBBox(x=1, y=2, width=3, height=4),
                ),
                AIInferencePrediction(
                    model_label="sports ball",
                    confidence=0.77,
                    bbox=AIInferenceBBox(x=5, y=6, width=7, height=8),
                ),
                AIInferencePrediction(
                    model_label="mystery",
                    confidence=0.66,
                    bbox=AIInferenceBBox(x=9, y=10, width=11, height=12),
                ),
            ],
        )
    )
    service = WebcamInferenceService(ai_client=fake_client)

    result = service.analyze_frame(Image.new("RGB", (32, 24), color=(1, 2, 3)))

    assert [detected.class_code for detected in result.detected_objects] == ["FOOTWEAR", "BALL", None]
    assert [detected.group_code for detected in result.detected_objects] == ["PERSONAL_ITEM", "PERSONAL_ITEM", None]
    assert result.detected_objects[0].class_name_ko == "신발"
    assert result.detected_objects[1].class_name_ko == "공"
    assert result.detected_objects[2].label == "mystery"
    assert result.detected_objects[2].class_name_ko is None


@pytest.mark.parametrize("model_label", ["shoe", "sneaker", "footwear"])
def test_webcam_footwear_metadata_contract(model_label: str) -> None:
    fake_client = FakeAIInferenceClient(
        AIInferenceResult(
            media_width=32,
            media_height=24,
            inference_ms=7.5,
            predictions=[
                AIInferencePrediction(
                    model_label=model_label,
                    confidence=0.91,
                    bbox=AIInferenceBBox(x=1, y=2, width=3, height=4),
                )
            ],
        )
    )

    detected = WebcamInferenceService(ai_client=fake_client).analyze_frame(
        Image.new("RGB", (32, 24), color=(1, 2, 3))
    ).detected_objects[0]

    assert detected.class_code == "FOOTWEAR"
    assert detected.class_name_ko == "신발"
    assert detected.group_code == "PERSONAL_ITEM"


def test_detection_inference_maps_ai_unavailable_to_service_error(tmp_path: Path) -> None:
    from app.services.ai_inference_client import AIInferenceUnavailableError

    image_path = tmp_path / "sample.jpg"
    image_path.write_bytes(jpeg_payload())
    service = DetectionInferenceService(ai_client=FailingAIInferenceClient(AIInferenceUnavailableError("down")))

    with pytest.raises(DetectionInferenceUnavailableError):
        service.analyze_image(image_path)


def test_video_timeout_is_not_reported_as_model_unavailable(tmp_path: Path) -> None:
    from app.services.ai_inference_client import AIInferenceTimeoutError
    from app.services.detection_inference import DetectionInferenceTimeoutError

    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"mp4")
    service = DetectionInferenceService(ai_client=FailingAIInferenceClient(AIInferenceTimeoutError("slow")))

    with pytest.raises(DetectionInferenceTimeoutError, match="AI video inference timed out"):
        service.analyze_video(video_path)


def test_video_generic_ai_unavailable_keeps_existing_safe_handling(tmp_path: Path) -> None:
    from app.services.ai_inference_client import AIInferenceUnavailableError

    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"mp4")
    service = DetectionInferenceService(ai_client=FailingAIInferenceClient(AIInferenceUnavailableError("down")))

    with pytest.raises(DetectionInferenceUnavailableError, match="AI detection model is not configured"):
        service.analyze_video(video_path)


def test_image_inference_deduplicates_overlapping_same_class_predictions(
    client: TestClient,
    db: Session,
) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    fake_client = FakeAIInferenceClient(
        AIInferenceResult(
            media_width=160,
            media_height=140,
            inference_ms=21.0,
            predictions=[
                AIInferencePrediction(
                    model_label="backpack",
                    confidence=0.82,
                    bbox=AIInferenceBBox(x=10, y=10, width=100, height=100),
                ),
                AIInferencePrediction(
                    model_label="handbag",
                    confidence=0.44,
                    bbox=AIInferenceBBox(x=18, y=18, width=92, height=92),
                ),
            ],
        )
    )
    app.dependency_overrides[get_inference_service] = lambda: DetectionInferenceService(ai_client=fake_client)

    response = client.post("/api/detections/images", files=image_file(jpeg_payload(width=160, height=140)))

    assert response.status_code == 201
    body = response.json()
    assert len(body["detected_objects"]) == 1
    assert body["detected_objects"][0]["class_code"] == "BAG"
    assert body["detected_objects"][0]["confidence"] == 0.82


def test_invalid_image_inference_marks_event_failed(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    app.dependency_overrides[get_inference_service] = lambda: DetectionInferenceService(
        ai_client=FailingAIInferenceClient(RuntimeError("broken inference"))
    )

    response = client.post("/api/detections/images", files=image_file())

    assert response.status_code == 500
    event = db.query(DetectionEvent).one()
    assert event.status == "FAILED"
    assert event.error_message == "AI detection could not be completed"


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


def test_user_analysis_summary_requires_user_role_and_supported_period(client: TestClient, db: Session) -> None:
    admin = seed_user(db, 1, role="ADMIN")
    user = seed_user(db, 2)

    assert client.get("/api/detections/me/summary").status_code == 401

    authenticate(client, admin)
    assert client.get("/api/detections/me/summary").status_code == 403

    authenticate(client, user)
    assert client.get("/api/detections/me/summary?days=14").status_code == 422


def test_user_analysis_summary_scopes_private_completed_object_stats(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    other = seed_user(db, 2)
    seed_object_class(db, 1, "BALL")
    seed_object_class(db, 2, "FOOTWEAR")
    seed_object_class(db, 3, "TRASH", group_code="WASTE")
    seed_object_class(db, 4, "HAT")
    now = utc_now()

    db.add_all(
        [
            DetectionEvent(
                id=101,
                user_id=user.id,
                purpose="USER_ANALYSIS",
                source_type="IMAGE",
                original_media_url="detections/user/1/private-image.jpg",
                ai_model_id="safe-model-id",
                media_width=100,
                media_height=80,
                status="COMPLETED",
                captured_at=now - timedelta(days=1),
                processing_completed_at=now - timedelta(days=1),
                created_at=now - timedelta(days=1),
                updated_at=now - timedelta(days=1),
            ),
            DetectionEvent(
                id=102,
                user_id=user.id,
                purpose="USER_ANALYSIS",
                source_type="VIDEO",
                original_media_url="detections/user/1/failed-video.mp4",
                status="FAILED",
                error_message="secret stacktrace /srv/private/model.pt",
                captured_at=now - timedelta(days=2),
                processing_completed_at=now - timedelta(days=2),
                created_at=now - timedelta(days=2),
                updated_at=now - timedelta(days=2),
            ),
            DetectionEvent(
                id=103,
                user_id=user.id,
                purpose="USER_ANALYSIS",
                source_type="VIDEO",
                original_media_url="detections/user/1/processing-video.mp4",
                status="PROCESSING",
                captured_at=now,
                processing_started_at=now,
                created_at=now,
                updated_at=now,
            ),
            DetectionEvent(
                id=104,
                user_id=user.id,
                purpose="OPERATION",
                source_type="IMAGE",
                original_media_url="detections/operation/excluded.jpg",
                status="COMPLETED",
                captured_at=now,
                created_at=now,
                updated_at=now,
            ),
            DetectionEvent(
                id=105,
                user_id=other.id,
                purpose="USER_ANALYSIS",
                source_type="IMAGE",
                original_media_url="detections/user/2/excluded.jpg",
                status="COMPLETED",
                captured_at=now,
                created_at=now,
                updated_at=now,
            ),
        ]
    )
    db.add_all(
        [
            DetectedObject(
                id=201,
                detection_event_id=101,
                object_class_id=1,
                processing_status="PENDING",
                confidence=Decimal("0.9500"),
                bbox_x=Decimal("1"),
                bbox_y=Decimal("2"),
                bbox_width=Decimal("30"),
                bbox_height=Decimal("40"),
                appearance_count=1,
                detected_at=now,
                created_at=now,
            ),
            DetectedObject(
                id=202,
                detection_event_id=101,
                object_class_id=4,
                processing_status="PENDING",
                confidence=Decimal("0.4900"),
                bbox_x=Decimal("5"),
                bbox_y=Decimal("6"),
                bbox_width=Decimal("10"),
                bbox_height=Decimal("11"),
                appearance_count=1,
                detected_at=now,
                created_at=now,
            ),
            DetectedObject(
                id=203,
                detection_event_id=102,
                object_class_id=3,
                processing_status="PENDING",
                confidence=Decimal("0.9900"),
                bbox_x=Decimal("1"),
                bbox_y=Decimal("1"),
                bbox_width=Decimal("5"),
                bbox_height=Decimal("5"),
                appearance_count=1,
                detected_at=now,
                created_at=now,
            ),
            DetectedObject(
                id=204,
                detection_event_id=104,
                object_class_id=3,
                processing_status="PENDING",
                confidence=Decimal("0.9900"),
                bbox_x=Decimal("1"),
                bbox_y=Decimal("1"),
                bbox_width=Decimal("5"),
                bbox_height=Decimal("5"),
                appearance_count=1,
                detected_at=now,
                created_at=now,
            ),
            DetectedObject(
                id=205,
                detection_event_id=105,
                object_class_id=1,
                processing_status="PENDING",
                confidence=Decimal("0.9900"),
                bbox_x=Decimal("1"),
                bbox_y=Decimal("1"),
                bbox_width=Decimal("5"),
                bbox_height=Decimal("5"),
                appearance_count=1,
                detected_at=now,
                created_at=now,
            ),
        ]
    )
    db.commit()
    authenticate(client, user)

    response = client.get("/api/detections/me/summary?days=30")

    assert response.status_code == 200
    body = response.json()
    assert body["total_analyses"] == 3
    assert body["completed_count"] == 1
    assert body["failed_count"] == 1
    assert body["in_progress_count"] == 1
    assert body["image_count"] == 1
    assert body["video_count"] == 2
    assert body["total_detected_objects"] == 2
    assert body["average_confidence"] == 0.72
    assert [item["class_code"] for item in body["class_distribution"]] == ["BALL", "FOOTWEAR", "TRASH", "HAT"]
    assert {item["class_code"]: item["count"] for item in body["class_distribution"]} == {
        "BALL": 1,
        "FOOTWEAR": 0,
        "TRASH": 0,
        "HAT": 1,
    }
    assert {item["code"]: item["count"] for item in body["confidence_distribution"]} == {
        "GE_90": 1,
        "GE_70": 0,
        "GE_50": 0,
        "LT_50": 1,
    }
    assert [event["id"] for event in body["recent_events"]] == [103, 101, 102]
    assert "original_media_url" not in response.text
    assert "secret stacktrace" not in response.text
    assert "/srv/private" not in response.text


@pytest.mark.parametrize(
    ("days", "expected_start_date"),
    [(7, "2026-08-26"), (30, "2026-08-03"), (90, "2026-06-04")],
)
def test_user_analysis_summary_uses_kst_calendar_period_start(days: int, expected_start_date: str) -> None:
    period_start, period_end, trend_dates = analysis_period_window(
        days,
        now=datetime(2026, 9, 1, 14, 30, tzinfo=UTC),
    )

    assert period_start.astimezone(KST).isoformat() == f"{expected_start_date}T00:00:00+09:00"
    assert period_end.isoformat() == "2026-09-01T14:30:00+00:00"
    assert trend_dates[0] == expected_start_date
    assert trend_dates[-1] == "2026-09-01"
    assert len(trend_dates) == days


def test_user_analysis_summary_kst_boundary_matches_daily_trend(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BALL")
    generated_at = datetime(2026, 9, 1, 15, 30, tzinfo=UTC)  # 2026-09-02 00:30 KST
    included_start = datetime(2026, 8, 26, 15, 0, tzinfo=UTC)  # 2026-08-27 00:00 KST
    excluded_before_start = included_start - timedelta(microseconds=1)
    included_before_now = generated_at - timedelta(minutes=1)
    excluded_after_now = generated_at + timedelta(seconds=1)

    db.add_all(
        [
            DetectionEvent(id=401, user_id=user.id, purpose="USER_ANALYSIS", source_type="IMAGE", original_media_url="a.jpg", status="COMPLETED", captured_at=included_start, processing_completed_at=included_start, created_at=included_start, updated_at=included_start),
            DetectionEvent(id=402, user_id=user.id, purpose="USER_ANALYSIS", source_type="VIDEO", original_media_url="b.mp4", status="COMPLETED", captured_at=included_before_now, processing_completed_at=included_before_now, created_at=included_before_now, updated_at=included_before_now),
            DetectionEvent(id=403, user_id=user.id, purpose="USER_ANALYSIS", source_type="IMAGE", original_media_url="old.jpg", status="COMPLETED", captured_at=excluded_before_start, processing_completed_at=excluded_before_start, created_at=excluded_before_start, updated_at=excluded_before_start),
            DetectionEvent(id=404, user_id=user.id, purpose="USER_ANALYSIS", source_type="IMAGE", original_media_url="future.jpg", status="COMPLETED", captured_at=excluded_after_now, processing_completed_at=excluded_after_now, created_at=excluded_after_now, updated_at=excluded_after_now),
        ]
    )
    db.add_all(
        [
            DetectedObject(id=501, detection_event_id=401, object_class_id=1, processing_status="PENDING", confidence=Decimal("0.8000"), bbox_x=Decimal("1"), bbox_y=Decimal("1"), bbox_width=Decimal("5"), bbox_height=Decimal("5"), appearance_count=1, detected_at=included_start, created_at=included_start),
            DetectedObject(id=502, detection_event_id=402, object_class_id=1, processing_status="PENDING", confidence=Decimal("0.9000"), bbox_x=Decimal("1"), bbox_y=Decimal("1"), bbox_width=Decimal("5"), bbox_height=Decimal("5"), appearance_count=1, detected_at=included_before_now, created_at=included_before_now),
            DetectedObject(id=503, detection_event_id=403, object_class_id=1, processing_status="PENDING", confidence=Decimal("0.9900"), bbox_x=Decimal("1"), bbox_y=Decimal("1"), bbox_width=Decimal("5"), bbox_height=Decimal("5"), appearance_count=1, detected_at=excluded_before_start, created_at=excluded_before_start),
            DetectedObject(id=504, detection_event_id=404, object_class_id=1, processing_status="PENDING", confidence=Decimal("0.9900"), bbox_x=Decimal("1"), bbox_y=Decimal("1"), bbox_width=Decimal("5"), bbox_height=Decimal("5"), appearance_count=1, detected_at=excluded_after_now, created_at=excluded_after_now),
        ]
    )
    db.commit()

    body = build_user_analysis_summary(db, user_id=user.id, days=7, now=generated_at).model_dump()

    assert body["period_start"] == included_start
    assert body["period_end"] == generated_at
    assert body["total_analyses"] == 2
    assert body["total_detected_objects"] == 2
    assert sum(item["analysis_count"] for item in body["daily_trend"]) == body["total_analyses"]
    assert sum(item["object_count"] for item in body["daily_trend"]) == body["total_detected_objects"]
    assert body["daily_trend"][0] == {"date": "2026-08-27", "analysis_count": 1, "object_count": 1}
    assert body["daily_trend"][-1] == {"date": "2026-09-02", "analysis_count": 1, "object_count": 1}


def test_user_analysis_summary_empty_period_has_consistent_zero_totals(db: Session) -> None:
    user = seed_user(db, 1)

    body = build_user_analysis_summary(
        db,
        user_id=user.id,
        days=30,
        now=datetime(2026, 9, 1, 4, 0, tzinfo=UTC),
    ).model_dump()

    assert body["total_analyses"] == 0
    assert body["total_detected_objects"] == 0
    assert sum(item["analysis_count"] for item in body["daily_trend"]) == 0
    assert len(body["daily_trend"]) == 30


def test_video_terminal_notifications_are_safe_and_idempotent(db: Session) -> None:
    user = seed_user(db, 1)
    now = utc_now()
    completed_event = DetectionEvent(
        id=301,
        user_id=user.id,
        purpose="USER_ANALYSIS",
        source_type="VIDEO",
        original_media_url="detections/user/1/video.mp4",
        status="COMPLETED",
        captured_at=now,
        processing_completed_at=now,
        created_at=now,
        updated_at=now,
    )
    failed_event = DetectionEvent(
        id=302,
        user_id=user.id,
        purpose="USER_ANALYSIS",
        source_type="VIDEO",
        original_media_url="detections/user/1/failed.mp4",
        status="FAILED",
        error_message="stacktrace with /app/models/secret.pt",
        captured_at=now,
        processing_completed_at=now,
        created_at=now,
        updated_at=now,
    )
    image_event = DetectionEvent(
        id=303,
        user_id=user.id,
        purpose="USER_ANALYSIS",
        source_type="IMAGE",
        original_media_url="detections/user/1/image.jpg",
        status="COMPLETED",
        captured_at=now,
        processing_completed_at=now,
        created_at=now,
        updated_at=now,
    )
    operation_event = DetectionEvent(
        id=304,
        user_id=user.id,
        purpose="OPERATION",
        source_type="VIDEO",
        original_media_url="detections/operation/video.mp4",
        status="COMPLETED",
        captured_at=now,
        processing_completed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add_all([completed_event, failed_event, image_event, operation_event])
    db.commit()

    assert ensure_detection_terminal_notification(db, event=completed_event) is not None
    assert ensure_detection_terminal_notification(db, event=completed_event) is None
    assert ensure_detection_terminal_notification(db, event=failed_event) is not None
    assert ensure_detection_terminal_notification(db, event=image_event) is None
    assert ensure_detection_terminal_notification(db, event=operation_event) is None
    db.commit()

    notifications = db.query(Notification).order_by(Notification.related_id, Notification.notification_type).all()
    assert [(item.notification_type, item.related_type, item.related_id) for item in notifications] == [
        ("DETECTION_COMPLETED", "DETECTION_EVENT", 301),
        ("DETECTION_FAILED", "DETECTION_EVENT", 302),
    ]
    assert "analysis-report?eventId" not in " ".join(item.message for item in notifications)
    assert "secret.pt" not in " ".join(item.message for item in notifications)
    assert "/app/models" not in " ".join(item.message for item in notifications)


def test_video_notification_unique_conflict_preserves_completed_event(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BALL")
    now = utc_now()
    event = DetectionEvent(
        id=351,
        user_id=user.id,
        purpose="USER_ANALYSIS",
        source_type="VIDEO",
        original_media_url="detections/user/1/video.mp4",
        result_media_url="detections/user/1/video-result.mp4",
        result_media_bytes=128,
        status="COMPLETED",
        captured_at=now,
        processing_completed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(event)
    db.add(
        DetectedObject(
            id=451,
            detection_event_id=351,
            object_class_id=1,
            processing_status="PENDING",
            confidence=Decimal("0.9100"),
            bbox_x=Decimal("1"),
            bbox_y=Decimal("1"),
            bbox_width=Decimal("5"),
            bbox_height=Decimal("5"),
            appearance_count=2,
            detected_at=now,
            created_at=now,
        )
    )
    db.commit()

    real_scalar = db.scalar
    inserted_racing_notification = False

    def racing_scalar(statement, *args, **kwargs):
        nonlocal inserted_racing_notification
        if not inserted_racing_notification and "notifications" in str(statement):
            inserted_racing_notification = True
            db.add(
                Notification(
                    user_id=user.id,
                    notification_type="DETECTION_COMPLETED",
                    title="이미 생성된 알림",
                    message="경쟁 트랜잭션이 먼저 만든 알림",
                    related_type="DETECTION_EVENT",
                    related_id=event.id,
                    created_at=now,
                )
            )
            db.flush()
            return None
        return real_scalar(statement, *args, **kwargs)

    monkeypatch.setattr(db, "scalar", racing_scalar)

    assert ensure_detection_terminal_notification(db, event=event) is None
    db.commit()
    db.expire_all()

    stored = db.get(DetectionEvent, event.id)
    assert stored.status == "COMPLETED"
    assert stored.result_media_url == "detections/user/1/video-result.mp4"
    assert db.query(DetectedObject).filter(DetectedObject.detection_event_id == event.id).count() == 1
    assert db.query(Notification).filter(Notification.related_id == event.id).count() == 1


def test_user_can_delete_own_detection_history_event(client: TestClient, db: Session, tmp_path: Path) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    media_key = "detections/user/1/delete-me.jpg"
    media_path = tmp_path / "uploads" / media_key
    media_path.parent.mkdir(parents=True)
    media_path.write_bytes(jpeg_payload())
    db.add(
        DetectionEvent(
            id=20,
            user_id=user.id,
            purpose="USER_ANALYSIS",
            source_type="VIDEO",
            original_media_url=media_key,
            status="COMPLETED",
            captured_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    db.add(
        DetectedObject(
            id=30,
            detection_event_id=20,
            object_class_id=1,
            processing_status="PENDING",
            confidence=Decimal("0.9000"),
            bbox_x=Decimal("1"),
            bbox_y=Decimal("2"),
            bbox_width=Decimal("30"),
            bbox_height=Decimal("40"),
            appearance_count=1,
            detected_at=now,
            created_at=now,
        )
    )
    db.add(
        VideoJob(
            id=40,
            detection_event_id=20,
            status="COMPLETED",
            processing_progress=100,
            tracking_algorithm="BYTE_TRACK",
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()
    authenticate(client, user)

    response = client.delete("/api/detections/20")

    assert response.status_code == 200
    assert db.get(DetectionEvent, 20) is None
    assert db.get(DetectedObject, 30) is None
    assert db.get(VideoJob, 40) is None
    assert not media_path.exists()


def test_delete_detection_history_is_limited_to_current_user_analysis_events(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    other = seed_user(db, 2)
    now = utc_now()
    db.add_all(
        [
            DetectionEvent(
                id=20,
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
                id=21,
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
                id=22,
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

    other_response = client.delete("/api/detections/21")
    operation_response = client.delete("/api/detections/22")
    own_response = client.delete("/api/detections/20")

    assert other_response.status_code == 404
    assert operation_response.status_code == 404
    assert own_response.status_code == 200
    assert db.get(DetectionEvent, 20) is None
    assert db.get(DetectionEvent, 21) is not None
    assert db.get(DetectionEvent, 22) is not None


def test_user_can_delete_all_own_detection_history_without_operation_events(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    now = utc_now()
    db.add_all(
        [
            DetectionEvent(
                id=20,
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
                id=21,
                user_id=user.id,
                purpose="USER_ANALYSIS",
                source_type="IMAGE",
                original_media_url="detections/user/1/b.jpg",
                status="COMPLETED",
                captured_at=now + timedelta(seconds=1),
                created_at=now + timedelta(seconds=1),
                updated_at=now + timedelta(seconds=1),
            ),
            DetectionEvent(
                id=22,
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

    response = client.delete("/api/detections/me")

    assert response.status_code == 200
    assert db.get(DetectionEvent, 20) is None
    assert db.get(DetectionEvent, 21) is None
    assert db.get(DetectionEvent, 22) is not None


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


def test_upload_policy_returns_safe_public_limits(client: TestClient) -> None:
    response = client.get("/api/detections/upload-policy")

    assert response.status_code == 200
    body = response.json()
    assert body["image"]["source_max_bytes"] == 20 * 1024 * 1024
    assert body["image"]["normalized_hard_max_bytes"] == 5 * 1024 * 1024
    assert body["video"]["max_bytes"] == 100 * 1024 * 1024
    assert body["video"]["max_duration_seconds"] == 30
    assert body["quota"]["media_storage_bytes"] == 1024 * 1024 * 1024


def test_storage_usage_counts_only_user_analysis_media(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    other = seed_user(db, 2)
    authenticate(client, user)
    now = utc_now()
    db.add_all(
        [
            DetectionEvent(
                user_id=user.id,
                purpose="USER_ANALYSIS",
                source_type="IMAGE",
                original_media_url="detections/user/1/a.jpg",
                original_media_bytes=100,
                result_media_bytes=None,
                status="COMPLETED",
                captured_at=now,
                processing_started_at=now,
                processing_completed_at=now,
                created_at=now,
                updated_at=now,
            ),
            DetectionEvent(
                user_id=user.id,
                purpose="USER_ANALYSIS",
                source_type="VIDEO",
                original_media_url="detections/user/1/b.mp4",
                original_media_bytes=200,
                result_media_url="detections/user/1/b-result.mp4",
                result_media_bytes=300,
                status="COMPLETED",
                captured_at=now,
                processing_started_at=now,
                processing_completed_at=now,
                created_at=now,
                updated_at=now,
            ),
            DetectionEvent(
                user_id=user.id,
                purpose="OPERATION",
                source_type="IMAGE",
                original_media_url="detections/admin/c.jpg",
                original_media_bytes=999,
                status="COMPLETED",
                captured_at=now,
                processing_started_at=now,
                processing_completed_at=now,
                created_at=now,
                updated_at=now,
            ),
            DetectionEvent(
                user_id=other.id,
                purpose="USER_ANALYSIS",
                source_type="IMAGE",
                original_media_url="detections/user/2/d.jpg",
                original_media_bytes=999,
                status="COMPLETED",
                captured_at=now,
                processing_started_at=now,
                processing_completed_at=now,
                created_at=now,
                updated_at=now,
            ),
        ]
    )
    db.commit()

    response = client.get("/api/detections/me/storage-usage")

    assert response.status_code == 200
    body = response.json()
    assert body["used_bytes"] == 600
    assert body["image_count_last_24h"] == 1
    assert body["video_count_last_24h"] == 1
    assert body["active_video_jobs"] == 0
    assert body["has_unknown_legacy_usage"] is False


def test_storage_usage_flags_legacy_media_with_unknown_bytes(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    now = utc_now()
    db.add(
        DetectionEvent(
            user_id=user.id,
            purpose="USER_ANALYSIS",
            source_type="VIDEO",
            original_media_url="detections/user/1/legacy.mp4",
            original_media_bytes=None,
            result_media_url="detections/user/1/legacy-result.mp4",
            result_media_bytes=None,
            status="COMPLETED",
            captured_at=now,
            processing_started_at=now,
            processing_completed_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()

    response = client.get("/api/detections/me/storage-usage")

    assert response.status_code == 200
    body = response.json()
    assert body["used_bytes"] == 0
    assert body["has_unknown_legacy_usage"] is True


def test_image_detection_records_normalized_file_size(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    override_inference(DetectionInferenceResult(media_width=64, media_height=48, detections=[]))

    response = client.post("/api/detections/images", files=image_file(jpeg_payload(width=64, height=48)))

    assert response.status_code == 201
    event = db.query(DetectionEvent).one()
    stored = Path(get_settings().UPLOAD_DIR) / event.original_media_url
    assert stored.exists()
    assert event.original_media_bytes == stored.stat().st_size
    assert response.json()["original_media_bytes"] == stored.stat().st_size


def test_image_quota_rejects_recent_limit_without_persisting_media(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    settings = get_settings()
    monkeypatch.setattr(settings, "USER_IMAGE_ROLLING_24H_LIMIT", 1)
    now = utc_now()
    db.add(
        DetectionEvent(
            user_id=user.id,
            purpose="USER_ANALYSIS",
            source_type="IMAGE",
            original_media_url="detections/user/1/existing.jpg",
            original_media_bytes=10,
            status="COMPLETED",
            captured_at=now,
            processing_started_at=now,
            processing_completed_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()

    response = client.post("/api/detections/images", files=image_file(jpeg_payload()))

    assert response.status_code == 429
    assert db.query(DetectionEvent).count() == 1
    upload_root = Path(get_settings().UPLOAD_DIR)
    assert not list((upload_root / "detections" / "user" / str(user.id)).glob("*.jpg"))


def test_video_active_job_quota_rejects_second_upload(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    now = utc_now()
    event = DetectionEvent(
        user_id=user.id,
        purpose="USER_ANALYSIS",
        source_type="VIDEO",
        original_media_url="detections/user/1/active.mp4",
        original_media_bytes=100,
        status="PROCESSING",
        captured_at=now,
        processing_started_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(event)
    db.flush()
    db.add(
        VideoJob(
            detection_event_id=event.id,
            status="PROCESSING",
            processing_stage="ANALYZING",
            processing_progress=30,
            processed_frames=10,
            tracking_algorithm="BYTE_TRACK",
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 409
    assert db.query(DetectionEvent).count() == 1


def test_video_probe_failure_cleans_staged_upload_without_event(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)

    def reject_probe(media_path: Path, *, settings):
        raise HTTPException(status_code=415, detail="Uploaded file is not a valid MP4 video")

    monkeypatch.setattr("app.api.detections.validate_saved_user_video", reject_probe)

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 415
    assert db.query(DetectionEvent).count() == 0
    assert not list((Path(get_settings().UPLOAD_DIR) / "detections" / "user" / str(user.id)).glob("*.mp4"))


def test_video_probe_validation_rejects_bad_duration_and_source_dimensions() -> None:
    settings = get_settings()

    validate_video_probe({"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "width": 1920, "height": 1080, "duration": 30, "fps": 30}, settings=settings)
    with pytest.raises(HTTPException) as long_video:
        validate_video_probe({"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "width": 1920, "height": 1080, "duration": 31, "fps": 30}, settings=settings)
    with pytest.raises(HTTPException) as huge_video:
        validate_video_probe({"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "width": 5000, "height": 1080, "duration": 10, "fps": 30}, settings=settings)
    with pytest.raises(HTTPException) as invalid_format:
        validate_video_probe({"format_name": "matroska,webm", "width": 1920, "height": 1080, "duration": 10, "fps": 30}, settings=settings)

    assert long_video.value.status_code == 413
    assert huge_video.value.status_code == 413
    assert invalid_format.value.status_code == 415


def test_video_command_timeout_is_reported_as_safe_gateway_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=["ffprobe"], timeout=1)

    monkeypatch.setattr(subprocess, "run", raise_timeout)

    with pytest.raises(HTTPException) as exc:
        _run_command(["ffprobe"], timeout=1)

    assert exc.value.status_code == 504
    assert exc.value.detail == "Video processing timed out"


@pytest.mark.parametrize("role", ["USER", "ADMIN"])
def test_webcam_detection_frame_is_allowed_for_user_and_admin(client: TestClient, db: Session, role: str) -> None:
    user = seed_user(db, 1, role=role)
    authenticate(client, user)
    override_webcam_inference(
        WebcamDetectionFrame(
            media_width=64,
            media_height=48,
            inference_ms=12.5,
            detected_objects=[
                WebcamDetectionObject(
                    label="backpack",
                    confidence=0.91,
                    bbox=DetectionBBox(x=5, y=6, width=20, height=22),
                )
            ],
        )
    )

    response = client.post("/api/detections/webcam/frame", files=webcam_file())

    assert response.status_code == 200
    body = response.json()
    assert body["media_width"] == 64
    assert body["media_height"] == 48
    assert body["inference_ms"] == 12.5
    assert "model_name" not in body
    assert body["detected_objects"][0]["label"] == "backpack"
    assert body["detected_objects"][0]["class_code"] is None
    assert body["detected_objects"][0]["class_name_ko"] is None
    assert body["detected_objects"][0]["group_code"] is None
    assert body["detected_objects"][0]["confidence"] == 0.91
    assert body["detected_objects"][0]["bbox"] == {"x": 5.0, "y": 6.0, "width": 20.0, "height": 22.0}
    assert db.query(DetectionEvent).count() == 0
    assert db.query(DetectedObject).count() == 0
    assert db.query(VideoJob).count() == 0


def test_webcam_detection_rejects_invalid_frames(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    override_webcam_inference(WebcamDetectionFrame(media_width=64, media_height=48, inference_ms=0, detected_objects=[]))

    unsupported_response = client.post("/api/detections/webcam/frame", files=webcam_file(content_type="image/png"))
    empty_response = client.post("/api/detections/webcam/frame", files=webcam_file(content=b""))
    corrupted_response = client.post("/api/detections/webcam/frame", files=webcam_file(content=b"not-a-jpeg"))
    oversized_response = client.post("/api/detections/webcam/frame", files=webcam_file(content=b"x" * (2 * 1024 * 1024 + 1)))

    assert unsupported_response.status_code == 415
    assert empty_response.status_code == 400
    assert corrupted_response.status_code == 400
    assert oversized_response.status_code == 413
    assert db.query(DetectionEvent).count() == 0
    assert db.query(DetectedObject).count() == 0


def test_webcam_detection_model_unavailable_returns_503_without_persistence(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    override_webcam_inference(WebcamInferenceUnavailableError("model unavailable"))

    response = client.post("/api/detections/webcam/frame", files=webcam_file())

    assert response.status_code == 503
    assert response.json()["detail"] == "Webcam detection model is unavailable"
    assert db.query(DetectionEvent).count() == 0
    assert db.query(DetectedObject).count() == 0
    assert db.query(VideoJob).count() == 0


def test_video_detection_creates_video_job(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    override_inference(DetectionInferenceResult(media_width=None, media_height=None, detections=[], rendered_video=b"rendered"))

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 202
    assert response.json()["status"] == "PROCESSING"
    event = db.query(DetectionEvent).one()
    assert event.status == "PROCESSING"
    job = db.query(VideoJob).one()
    assert job.detection_event_id == response.json()["detection_event_id"]
    assert job.status == "PROCESSING"
    assert job.processing_stage == "QUEUED"
    assert job.processing_progress == 0
    assert job.processing_completed_at is None
    assert job.error_message is None


def test_video_worker_completes_queued_job_and_zero_detection_is_success(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})
    assert response.status_code == 202

    service = MockInferenceService(
        DetectionInferenceResult(media_width=320, media_height=180, detections=[], rendered_video=b"rendered")
    )
    assert process_one_job(db, inference_service=service) is True

    event = db.query(DetectionEvent).one()
    job = db.query(VideoJob).one()
    assert event.status == "COMPLETED"
    assert event.detected_objects == []
    assert job.status == "COMPLETED"
    assert job.processing_stage == "COMPLETED"
    assert job.processing_progress == 100


def test_video_worker_normalizes_user_video_before_inference(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class AssertingInferenceService:
        def analyze_video(self, media_path: Path, *, video_job_id: int | None = None) -> DetectionInferenceResult:
            assert media_path.read_bytes() == b"worker-normalized"
            return DetectionInferenceResult(media_width=320, media_height=180, detections=[], rendered_video=b"rendered")

    def fake_normalize(media_path: Path, *, settings):
        assert media_path.read_bytes() == b"mp4"
        media_path.write_bytes(b"worker-normalized")
        return media_path.stat().st_size

    user = seed_user(db, 1)
    authenticate(client, user)
    monkeypatch.setattr("app.workers.video_detection_worker.normalize_user_video_in_place", fake_normalize)

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 202
    assert process_one_job(db, inference_service=AssertingInferenceService()) is True
    event = db.query(DetectionEvent).one()
    assert event.status == "COMPLETED"
    assert event.original_media_bytes == len(b"worker-normalized")


def test_video_worker_cleans_original_and_result_when_result_exceeds_storage_quota(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})
    assert response.status_code == 202
    event = db.get(DetectionEvent, response.json()["detection_event_id"])
    media_path = Path(get_settings().UPLOAD_DIR) / event.original_media_url
    assert media_path.exists()
    rendered = b"result-video-too-large"
    monkeypatch.setattr(get_settings(), "USER_MEDIA_STORAGE_LIMIT_BYTES", len(b"normalized-video") + len(rendered) - 1)

    service = MockInferenceService(
        DetectionInferenceResult(media_width=320, media_height=180, detections=[], rendered_video=rendered)
    )

    assert process_one_job(db, inference_service=service) is True
    db.expire_all()
    failed_event = db.get(DetectionEvent, event.id)
    assert failed_event.status == "FAILED"
    assert failed_event.original_media_bytes == 0
    assert failed_event.result_media_url is None
    assert failed_event.result_media_bytes == 0
    assert not list(media_path.parent.glob(f"{media_path.stem}*"))


def test_video_worker_records_safe_timeout_message(client: TestClient, db: Session) -> None:
    from app.services.detection_inference import DetectionInferenceTimeoutError

    class TimeoutInferenceService:
        def analyze_video(self, media_path: Path, *, video_job_id: int | None = None) -> DetectionInferenceResult:
            raise DetectionInferenceTimeoutError("AI video inference timed out")

    user = seed_user(db, 1)
    authenticate(client, user)
    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})
    assert response.status_code == 202

    assert process_one_job(db, inference_service=TimeoutInferenceService()) is True

    event = db.query(DetectionEvent).one()
    job = db.query(VideoJob).one()
    assert event.status == "FAILED"
    assert job.status == "FAILED"
    assert job.failed_stage == "ANALYZING"
    assert event.error_message == VIDEO_TIMEOUT_ERROR_CODE
    assert "model is not configured" not in event.error_message
    notification = db.query(Notification).one()
    assert notification.notification_type == "DETECTION_FAILED"
    assert notification.message == "영상 분석 시간이 예상보다 길어 중단되었습니다. 다시 시도해주세요."
    authenticate(client, user)
    status_response = client.get(f"/api/detections/{event.id}/processing-status")
    assert status_response.json()["error_message"] == SAFE_VIDEO_TIMEOUT_MESSAGE


def test_video_status_is_owner_scoped_and_internal_progress_requires_key(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = seed_user(db, 1)
    other = seed_user(db, 2)
    authenticate(client, owner)
    accepted = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")}).json()
    event_id = accepted["detection_event_id"]
    job_id = accepted["video_job_id"]

    response = client.get(f"/api/detections/{event_id}/processing-status")
    assert response.status_code == 200
    assert response.json()["stage"] == "QUEUED"
    assert response.json()["analysis_progress"] is None

    authenticate(client, other)
    assert client.get(f"/api/detections/{event_id}/processing-status").status_code == 404
    client.cookies.clear()
    assert client.get(f"/api/detections/{event_id}/processing-status").status_code == 401

    key = "flowlink-test-ai-internal-key-32-chars"
    monkeypatch.setattr(get_settings(), "AI_INTERNAL_API_KEY", key)
    endpoint = f"/api/internal/video-jobs/{job_id}/progress"
    assert client.post(endpoint, json={"stage": "ANALYZING", "processed_frames": 3, "total_frames": 10}).status_code == 403
    assert client.post(endpoint, headers={"X-Internal-API-Key": "wrong"}, json={"stage": "ANALYZING"}).status_code == 403
    assert client.post(endpoint, headers={"X-Internal-API-Key": key}, json={"stage": "ANALYZING", "processed_frames": 298, "total_frames": 300}).status_code == 204
    db.expire_all()
    job = db.get(VideoJob, job_id)
    assert job.processing_stage == "ANALYZING"
    assert job.processed_frames == 298
    assert job.total_frames == 300

    assert client.post(endpoint, headers={"X-Internal-API-Key": key}, json={"stage": "RENDERING"}).status_code == 204
    db.expire_all()
    job = db.get(VideoJob, job_id)
    assert job.processing_stage == "RENDERING"
    assert job.processed_frames == 298
    authenticate(client, owner)
    status_response = client.get(f"/api/detections/{event_id}/processing-status")
    assert status_response.json()["stage"] == "RENDERING"
    assert status_response.json()["analysis_progress"] == 99


def test_video_job_claim_is_single_use_and_stale_processing_fails(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    claimed_at = utc_now() - timedelta(seconds=get_settings().VIDEO_JOB_STALE_SECONDS + 1)
    job_id = claim_next_queued_video_job(db, started_at=claimed_at)
    db.commit()
    assert job_id is not None
    assert claim_next_queued_video_job(db, started_at=utc_now()) is None
    assert fail_stale_jobs(db) == 1
    db.expire_all()
    job = db.get(VideoJob, job_id)
    assert job.status == "FAILED"
    assert job.processing_stage == "FAILED"
    assert job.failed_stage == "NORMALIZING"
    notification = db.query(Notification).one()
    assert notification.notification_type == "DETECTION_FAILED"
    assert notification.message == "영상 분석 시간이 예상보다 길어 중단되었습니다. 다시 시도해주세요."


@pytest.mark.parametrize("failed_stage", ["QUEUED", "NORMALIZING", "ANALYZING", "RENDERING", "SAVING"])
def test_video_status_preserves_failure_stage(client: TestClient, db: Session, failed_stage: str) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    accepted = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")}).json()
    event = db.get(DetectionEvent, accepted["detection_event_id"])
    event.video_job.processing_stage = failed_stage
    fail_detection_event(db, event=event, message="safe failure", completed_at=utc_now())
    db.commit()

    response = client.get(f"/api/detections/{event.id}/processing-status")
    assert response.status_code == 200
    assert response.json()["status"] == "FAILED"
    assert response.json()["stage"] == "FAILED"
    assert response.json()["failed_stage"] == failed_stage
    assert response.json()["error_message"] == "영상 분석을 완료하지 못했어요. 잠시 후 다시 시도해주세요."


@pytest.mark.parametrize(
    ("stored_message", "expected_message"),
    [
        (
            "영상 분석 시간이 예상보다 길어 중단되었어요. 잠시 후 다시 시도해주세요.",
            "영상 분석 시간이 예상보다 길어 중단되었어요. 잠시 후 다시 시도해주세요.",
        ),
        (
            "httpx failure at C:/private/video.mp4 using secret-key",
            "영상 분석을 완료하지 못했어요. 잠시 후 다시 시도해주세요.",
        ),
    ],
)
def test_video_status_exposes_only_whitelisted_failure_messages(
    client: TestClient,
    db: Session,
    stored_message: str,
    expected_message: str,
) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    accepted = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")}).json()
    event = db.get(DetectionEvent, accepted["detection_event_id"])
    event.video_job.processing_stage = "ANALYZING"
    fail_detection_event(db, event=event, message=stored_message, completed_at=utc_now())
    db.commit()

    response = client.get(f"/api/detections/{event.id}/processing-status")

    assert response.status_code == 200
    if is_video_timeout_error(stored_message):
        expected_message = SAFE_VIDEO_TIMEOUT_MESSAGE
    assert response.json()["error_message"] == expected_message
    assert "secret-key" not in response.text
    assert "C:/private" not in response.text


def test_video_detection_fails_when_rendered_result_video_is_missing(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    override_inference(DetectionInferenceResult(media_width=320, media_height=180, detections=[]))

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 202
    event = db.query(DetectionEvent).one()
    job = db.query(VideoJob).one()
    assert event.status == "PROCESSING"
    assert event.result_media_url is None
    assert job.status == "PROCESSING"


def test_video_detection_removes_rendered_result_video_when_db_save_fails(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    authenticate(client, user)
    override_inference(
        DetectionInferenceResult(
            media_width=320,
            media_height=180,
            rendered_video=b"rendered",
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

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 202
    assert db.query(DetectionEvent).one().status == "PROCESSING"
    assert db.query(DetectedObject).count() == 0
    assert not list((tmp_path / "uploads").glob("detections/user/1/*-result.mp4"))


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
