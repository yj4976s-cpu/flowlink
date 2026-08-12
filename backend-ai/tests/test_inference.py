from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import get_settings
from app.main import app
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
