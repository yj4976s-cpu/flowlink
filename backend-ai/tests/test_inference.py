from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import get_settings
from app.main import app
from app.schemas.inference import InferenceBBox, InferenceVideoTrack, VideoInferenceResponse
from app.services.inference import ImageInferenceService, InferenceModelUnavailableError, get_inference_service
from app.services.yolo_runtime import YoloBBox, YoloPrediction, YoloRuntime, get_yolo_runtime

TEST_INTERNAL_API_KEY = "test-internal-api-key"


class FakeRuntime:
    def __init__(self, predictions: list[YoloPrediction] | None = None, *, fail: bool = False) -> None:
        self.predictions = predictions or []
        self.fail = fail
        self.calls = 0

    def predict(self, image: Image.Image) -> list[YoloPrediction]:
        self.calls += 1
        if self.fail:
            from app.services.yolo_runtime import YoloRuntimeUnavailableError

            raise YoloRuntimeUnavailableError("model unavailable")
        assert image.mode == "RGB"
        return self.predictions


class FailingService:
    def analyze_image_bytes(self, payload: bytes, *, content_type: str):
        raise InferenceModelUnavailableError("model unavailable")


class FakeVideoService:
    def __init__(self) -> None:
        self.calls = 0

    def analyze_video_file(self, video_path, *, content_type: str) -> VideoInferenceResponse:
        self.calls += 1
        assert video_path.exists()
        assert content_type == "video/mp4"
        return VideoInferenceResponse(
            media_width=640,
            media_height=360,
            duration_ms=2000,
            frame_count=60,
            fps=30,
            inference_ms=14.5,
            tracks=[
                InferenceVideoTrack(
                    label="bag",
                    confidence=0.82,
                    bbox=InferenceBBox(x=10, y=20, width=100, height=120),
                    track_id=3,
                    first_seen_ms=100,
                    last_seen_ms=1400,
                    appearance_count=24,
                )
            ],
        )


@pytest.fixture(autouse=True)
def configure_internal_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "AI_INTERNAL_API_KEY", TEST_INTERNAL_API_KEY)


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def auth_headers() -> dict[str, str]:
    return {"X-Internal-API-Key": TEST_INTERNAL_API_KEY}


def image_payload(*, width: int = 32, height: int = 24, image_format: str = "JPEG") -> bytes:
    payload = BytesIO()
    Image.new("RGB", (width, height), color=(20, 90, 160)).save(payload, format=image_format)
    return payload.getvalue()


def image_file(content: bytes | None = None, content_type: str = "image/jpeg"):
    return {"file": ("sample.jpg", BytesIO(image_payload() if content is None else content), content_type)}


def video_file(content: bytes = b"fake-mp4", content_type: str = "video/mp4"):
    return {"file": ("sample.mp4", BytesIO(content), content_type)}


def test_health_does_not_require_model_load(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "flowlink-ai", "version": "0.1.0"}


def test_inference_rejects_missing_or_wrong_internal_key(client: TestClient) -> None:
    missing = client.post("/api/inference/images", files=image_file())
    wrong = client.post("/api/inference/images", files=image_file(), headers={"X-Internal-API-Key": "wrong"})

    assert missing.status_code == 403
    assert wrong.status_code == 403


def test_inference_rejects_when_internal_key_is_not_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "AI_INTERNAL_API_KEY", "")

    response = client.post("/api/inference/images", files=image_file(), headers=auth_headers())

    assert response.status_code == 403


def test_inference_returns_raw_yolo_predictions(client: TestClient) -> None:
    fake_runtime = FakeRuntime(
        [
            YoloPrediction(
                model_label="backpack",
                confidence=0.91,
                bbox=YoloBBox(x=2, y=3, width=10, height=12),
            )
        ]
    )
    app.dependency_overrides[get_inference_service] = lambda: ImageInferenceService(runtime=fake_runtime)

    response = client.post("/api/inference/images", files=image_file(), headers=auth_headers())

    assert response.status_code == 200
    assert fake_runtime.calls == 1
    body = response.json()
    assert body["media_width"] == 32
    assert body["media_height"] == 24
    assert body["inference_ms"] >= 0
    assert body["predictions"] == [
        {
            "label": "backpack",
            "confidence": 0.91,
            "bbox": {"x": 2.0, "y": 3.0, "width": 10.0, "height": 12.0},
        }
    ]


def test_inference_rejects_invalid_payloads(client: TestClient) -> None:
    app.dependency_overrides[get_inference_service] = lambda: ImageInferenceService(runtime=FakeRuntime())

    unsupported = client.post("/api/inference/images", files=image_file(content_type="text/plain"), headers=auth_headers())
    empty = client.post("/api/inference/images", files=image_file(content=b""), headers=auth_headers())
    corrupted = client.post("/api/inference/images", files=image_file(content=b"not-an-image"), headers=auth_headers())

    assert unsupported.status_code == 415
    assert empty.status_code == 400
    assert corrupted.status_code == 400


def test_inference_model_unavailable_returns_503(client: TestClient) -> None:
    app.dependency_overrides[get_inference_service] = lambda: FailingService()

    response = client.post("/api/inference/images", files=image_file(), headers=auth_headers())

    assert response.status_code == 503
    assert response.json()["detail"] == "AI model is unavailable"


def test_video_inference_streams_temp_file_and_returns_tracks(client: TestClient) -> None:
    fake_service = FakeVideoService()
    app.dependency_overrides[get_inference_service] = lambda: fake_service

    response = client.post("/api/inference/videos", files=video_file(), headers=auth_headers())

    assert response.status_code == 200
    assert fake_service.calls == 1
    assert response.json() == {
        "media_width": 640,
        "media_height": 360,
        "duration_ms": 2000,
        "frame_count": 60,
        "fps": 30.0,
        "inference_ms": 14.5,
        "tracks": [
            {
                "label": "bag",
                "confidence": 0.82,
                "bbox": {"x": 10.0, "y": 20.0, "width": 100.0, "height": 120.0},
                "track_id": 3,
                "first_seen_ms": 100,
                "last_seen_ms": 1400,
                "appearance_count": 24,
            }
        ],
    }


def test_video_inference_rejects_invalid_uploads(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    app.dependency_overrides[get_inference_service] = lambda: FakeVideoService()
    monkeypatch.setattr(get_settings(), "VIDEO_MAX_BYTES", 4)

    unsupported = client.post("/api/inference/videos", files=video_file(content_type="image/png"), headers=auth_headers())
    empty = client.post("/api/inference/videos", files=video_file(content=b""), headers=auth_headers())
    oversized = client.post("/api/inference/videos", files=video_file(content=b"12345"), headers=auth_headers())

    assert unsupported.status_code == 415
    assert empty.status_code == 400
    assert oversized.status_code == 413


def test_yolo_runtime_is_cached_and_lazy_loaded(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "DETECTION_MODEL", "fake-model.pt")
    monkeypatch.setattr(settings, "DETECTION_CONFIDENCE", 0.31)
    monkeypatch.setattr(settings, "DETECTION_IMGSZ", 512)
    get_yolo_runtime.cache_clear()

    first = get_yolo_runtime()
    second = get_yolo_runtime()

    assert first is second
    assert first.model_path == "fake-model.pt"
    assert first.confidence == 0.31
    assert first.imgsz == 512
    assert first._model is None
    get_yolo_runtime.cache_clear()


def test_yolo_runtime_resolves_models_from_backend_ai_and_repo_paths(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    backend_ai_dir = tmp_path / "backend-ai"
    repo_root = tmp_path
    backend_ai_model = backend_ai_dir / "models" / "local.pt"
    repo_ai_model = repo_root / "ai" / "custom.pt"
    repo_relative_model = repo_root / "ai" / "team.pt"
    backend_ai_model.parent.mkdir(parents=True)
    repo_ai_model.parent.mkdir(parents=True)
    backend_ai_model.write_bytes(b"model")
    repo_ai_model.write_bytes(b"model")
    repo_relative_model.write_bytes(b"model")
    monkeypatch.setattr("app.services.yolo_runtime.BACKEND_AI_DIR", backend_ai_dir)
    monkeypatch.setattr("app.services.yolo_runtime.REPO_ROOT", repo_root)

    assert YoloRuntime(model_path="local.pt", confidence=0.25, imgsz=640)._resolve_model_source() == str(backend_ai_model.resolve())
    assert YoloRuntime(model_path="custom.pt", confidence=0.25, imgsz=640)._resolve_model_source() == str(repo_ai_model.resolve())
    assert YoloRuntime(model_path="ai/team.pt", confidence=0.25, imgsz=640)._resolve_model_source() == str(repo_relative_model.resolve())


class FakeTensor:
    def __init__(self, value):
        self.value = value

    def tolist(self):
        return self.value


class FakeTrackBox:
    def __init__(self, *, xyxy, confidence: float, class_id: int, track_id: int | None) -> None:
        self.xyxy = [FakeTensor(xyxy)]
        self.conf = [confidence]
        self.cls = [class_id]
        self.id = FakeTensor([track_id]) if track_id is not None else None


class FakeTrackResult:
    def __init__(self, boxes) -> None:
        self.boxes = boxes


class FakeTrackModel:
    names = {0: "bag", 1: "trash"}

    def track(self, **kwargs):
        assert kwargs["tracker"] == "bytetrack.yaml"
        assert kwargs["stream"] is True
        assert kwargs["persist"] is False
        return [
            FakeTrackResult([FakeTrackBox(xyxy=[1, 2, 11, 22], confidence=0.44, class_id=0, track_id=7)]),
            FakeTrackResult([FakeTrackBox(xyxy=[3, 4, 13, 24], confidence=0.91, class_id=0, track_id=7)]),
            FakeTrackResult([FakeTrackBox(xyxy=[5, 6, 15, 26], confidence=0.72, class_id=1, track_id=None)]),
            FakeTrackResult([FakeTrackBox(xyxy=[7, 8, 17, 28], confidence=0.62, class_id=1, track_id=None)]),
        ]


def test_yolo_runtime_tracks_video_with_bytetrack_and_aggregates_by_track(tmp_path) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeTrackModel()

    tracks = runtime.track_video(video_path, fps=10, media_width=100, media_height=80)

    assert len(tracks) == 2
    assert tracks[0].model_label == "bag"
    assert tracks[0].track_id == 7
    assert tracks[0].confidence == 0.91
    assert tracks[0].bbox == YoloBBox(x=3.0, y=4.0, width=10.0, height=20.0)
    assert tracks[0].first_seen_ms == 0
    assert tracks[0].last_seen_ms == 100
    assert tracks[0].appearance_count == 2
    assert tracks[1].model_label == "trash"
    assert tracks[1].track_id is None
    assert tracks[1].appearance_count == 2
