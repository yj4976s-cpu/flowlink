from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
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
from app.models import Camera, DetectedObject, DetectionEvent, ObjectClass, User, VideoJob
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
from app.services.webcam_inference import (
    WebcamDetectionFrame,
    WebcamDetectionObject,
    WebcamInferenceService,
    WebcamInferenceUnavailableError,
    get_webcam_inference_service,
)


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
        self.image_calls = 0

    def infer_image_file(self, media_path: Path) -> AIInferenceResult:
        self.file_calls += 1
        assert media_path.exists()
        return self.result

    def infer_video_file(self, media_path: Path) -> AIInferenceVideoResult:
        self.video_file_calls += 1
        assert media_path.exists()
        assert self.video_result is not None
        return self.video_result

    def infer_image(self, image: Image.Image) -> AIInferenceResult:
        self.image_calls += 1
        assert image.mode == "RGB"
        return AIInferenceResult(
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

    def infer_video_file(self, media_path: Path) -> AIInferenceVideoResult:
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


def image_file(content: bytes = b"image-bytes") -> dict[str, tuple[str, BytesIO, str]]:
    return {"file": ("sample.jpg", BytesIO(content), "image/jpeg")}


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
    assert body["media_width"] == 80
    assert body["media_height"] == 60
    assert body["detected_objects"][0]["class_code"] == "BAG"
    assert body["detected_objects"][0]["confidence"] == 0.87


def test_default_video_inference_uses_backend_ai_client_and_preserves_tracks(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    seed_object_class(db, 1, "FOOTWEAR")
    seed_object_class(db, 2, "BALL")
    seed_object_class(db, 3, "TRASH", group_code="WASTE")
    authenticate(client, user)
    fake_client = FakeAIInferenceClient(
        AIInferenceResult(media_width=1, media_height=1, inference_ms=0, predictions=[]),
        video_result=AIInferenceVideoResult(
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

    assert response.status_code == 201
    assert fake_client.video_file_calls == 1
    body = response.json()
    assert body["status"] == "COMPLETED"
    assert body["media_width"] == 640
    assert body["media_height"] == 360
    assert [item["class_code"] for item in body["detected_objects"]] == ["FOOTWEAR", "BALL", "TRASH"]
    assert body["detected_objects"][0]["track_id"] == 4
    assert body["detected_objects"][0]["first_seen_ms"] == 133
    assert body["detected_objects"][0]["last_seen_ms"] == 2200
    assert body["detected_objects"][0]["appearance_count"] == 41
    event = db.query(DetectionEvent).one()
    job = db.query(VideoJob).one()
    assert event.status == "COMPLETED"
    assert event.result_media_url is not None
    assert event.result_media_url.endswith("-result.mp4")
    assert job.status == "COMPLETED"
    assert job.processing_progress == 100


def test_video_detection_processes_event_through_threadpool(
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

    assert response.status_code == 201
    assert called["value"] is True
    assert response.json()["status"] == "COMPLETED"


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


def test_video_detection_fails_when_rendered_result_video_is_missing(client: TestClient, db: Session) -> None:
    user = seed_user(db, 1)
    authenticate(client, user)
    override_inference(DetectionInferenceResult(media_width=320, media_height=180, detections=[]))

    response = client.post("/api/detections/videos", files={"file": ("sample.mp4", BytesIO(b"mp4"), "video/mp4")})

    assert response.status_code == 500
    event = db.query(DetectionEvent).one()
    job = db.query(VideoJob).one()
    assert event.status == "FAILED"
    assert event.result_media_url is None
    assert job.status == "FAILED"


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

    assert response.status_code == 500
    assert db.query(DetectionEvent).one().status == "FAILED"
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
