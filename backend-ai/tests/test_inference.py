from __future__ import annotations

from io import BytesIO
from pathlib import Path
import subprocess
import sys
import types
from zipfile import ZipFile

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import get_settings
from app.main import app
from app.schemas.inference import InferenceBBox, InferenceVideoTrack, VideoInferenceResponse
from app.services.inference import ImageInferenceService, InferenceModelUnavailableError, get_inference_service
from app.services.yolo_runtime import YoloBBox, YoloPrediction, YoloRuntime, get_yolo_runtime
from app.services.video_progress import VideoProgressReporter

TEST_INTERNAL_API_KEY = "test-internal-api-key"


class FakeRuntime:
    def __init__(self, predictions: list[YoloPrediction] | None = None, *, fail: bool = False) -> None:
        self.predictions = predictions or []
        self.fail = fail
        self.calls = 0
        self.image_sizes: list[tuple[int, int]] = []

    def predict(self, image: Image.Image) -> list[YoloPrediction]:
        self.calls += 1
        if self.fail:
            from app.services.yolo_runtime import YoloRuntimeUnavailableError

            raise YoloRuntimeUnavailableError("model unavailable")
        assert image.mode == "RGB"
        self.image_sizes.append(image.size)
        return self.predictions


class FailingService:
    def analyze_image_bytes(self, payload: bytes, *, content_type: str):
        raise InferenceModelUnavailableError("model unavailable")


class FakeVideoService:
    def __init__(self, *, write_rendered: bool = True) -> None:
        self.calls = 0
        self.write_rendered = write_rendered
        self.video_paths = []
        self.rendered_paths = []

    def analyze_video_file(self, video_path, *, content_type: str, rendered_video_path=None, video_job_id=None) -> VideoInferenceResponse:
        self.calls += 1
        self.video_paths.append(video_path)
        self.rendered_paths.append(rendered_video_path)
        assert video_path.exists()
        assert content_type == "video/mp4"
        assert video_job_id is None or video_job_id > 0
        if rendered_video_path is not None and self.write_rendered:
            rendered_video_path.write_bytes(b"rendered-h264-mp4")
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


def exif_oriented_jpeg_payload(*, width: int = 40, height: int = 20, orientation: int = 6) -> bytes:
    payload = BytesIO()
    exif = Image.Exif()
    exif[274] = orientation
    Image.new("RGB", (width, height), color=(20, 90, 160)).save(payload, format="JPEG", exif=exif)
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


@pytest.mark.parametrize("orientation", [6, 8])
def test_inference_applies_exif_orientation_before_prediction(orientation: int) -> None:
    fake_runtime = FakeRuntime()
    service = ImageInferenceService(runtime=fake_runtime)

    response = service.analyze_image_bytes(
        exif_oriented_jpeg_payload(orientation=orientation),
        content_type="image/jpeg",
    )

    assert fake_runtime.calls == 1
    assert fake_runtime.image_sizes == [(20, 40)]
    assert response.media_width == 20
    assert response.media_height == 40


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


def test_video_inference_render_true_returns_zip_and_cleans_temp_files(client: TestClient) -> None:
    fake_service = FakeVideoService()
    app.dependency_overrides[get_inference_service] = lambda: fake_service

    response = client.post("/api/inference/videos?render=true", files=video_file(), headers=auth_headers())

    assert response.status_code == 200
    assert response.headers["content-type"].split(";", 1)[0] == "application/zip"
    assert fake_service.calls == 1
    with ZipFile(BytesIO(response.content)) as bundle:
        assert sorted(bundle.namelist()) == ["result.json", "result.mp4"]
        parsed = VideoInferenceResponse.model_validate_json(bundle.read("result.json"))
        assert bundle.read("result.mp4") == b"rendered-h264-mp4"
    assert parsed.media_width == 640
    assert parsed.media_height == 360
    assert parsed.tracks[0].label == "bag"
    assert fake_service.video_paths and not fake_service.video_paths[0].exists()
    assert fake_service.rendered_paths and fake_service.rendered_paths[0] is not None
    assert not fake_service.rendered_paths[0].exists()


def test_video_inference_render_true_fails_when_render_file_is_missing_and_cleans_temp_files(
    client: TestClient,
) -> None:
    fake_service = FakeVideoService(write_rendered=False)
    app.dependency_overrides[get_inference_service] = lambda: fake_service

    response = client.post("/api/inference/videos?render=true", files=video_file(), headers=auth_headers())

    assert response.status_code == 503
    assert response.json()["detail"] == "AI model is unavailable"
    assert fake_service.video_paths and not fake_service.video_paths[0].exists()
    assert fake_service.rendered_paths and fake_service.rendered_paths[0] is not None
    assert not fake_service.rendered_paths[0].exists()


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

    def plot(self):
        return b"annotated-frame"


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


class FakeMultipleTrackModel:
    names = {0: "bag", 1: "trash"}

    def track(self, **kwargs):
        return [
            FakeTrackResult(
                [
                    FakeTrackBox(xyxy=[1, 2, 11, 22], confidence=0.44, class_id=0, track_id=7),
                    FakeTrackBox(xyxy=[21, 22, 31, 42], confidence=0.84, class_id=1, track_id=8),
                    FakeTrackBox(xyxy=[41, 42, 51, 62], confidence=0.74, class_id=1, track_id=None),
                ]
            ),
            FakeTrackResult(
                [
                    FakeTrackBox(xyxy=[3, 4, 13, 24], confidence=0.91, class_id=0, track_id=7),
                    FakeTrackBox(xyxy=[23, 24, 33, 44], confidence=0.64, class_id=1, track_id=8),
                    FakeTrackBox(xyxy=[43, 44, 53, 64], confidence=0.72, class_id=1, track_id=None),
                ]
            ),
        ]


class FakeMovingTrackModel:
    names = {0: "bag"}

    def track(self, **kwargs):
        return [
            FakeTrackResult([FakeTrackBox(xyxy=[1, 2, 11, 22], confidence=0.45, class_id=0, track_id=7)]),
            FakeTrackResult([FakeTrackBox(xyxy=[51, 2, 61, 22], confidence=0.70, class_id=0, track_id=7)]),
            FakeTrackResult([FakeTrackBox(xyxy=[91, 2, 101, 22], confidence=0.95, class_id=0, track_id=7)]),
        ]


class FakeEqualDistanceConfidenceTieBreakModel:
    names = {0: "bag"}

    def track(self, **kwargs):
        return [
            FakeTrackResult([FakeTrackBox(xyxy=[1, 2, 11, 22], confidence=0.70, class_id=0, track_id=7)]),
            FakeTrackResult([]),
            FakeTrackResult([FakeTrackBox(xyxy=[71, 2, 81, 22], confidence=0.90, class_id=0, track_id=7)]),
        ]


class FakeEqualDistanceFrameTieBreakModel:
    names = {0: "bag"}

    def track(self, **kwargs):
        return [
            FakeTrackResult([FakeTrackBox(xyxy=[1, 2, 11, 22], confidence=0.80, class_id=0, track_id=7)]),
            FakeTrackResult([]),
            FakeTrackResult([FakeTrackBox(xyxy=[71, 2, 81, 22], confidence=0.80, class_id=0, track_id=7)]),
        ]


def test_yolo_runtime_tracks_video_with_bytetrack_and_aggregates_valid_tracks(tmp_path) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeTrackModel()

    tracks = runtime.track_video(video_path, fps=10, media_width=100, media_height=80)

    assert len(tracks) == 1
    assert tracks[0].model_label == "bag"
    assert tracks[0].track_id == 7
    assert tracks[0].confidence == 0.91
    assert tracks[0].bbox == YoloBBox(x=3.0, y=4.0, width=10.0, height=20.0)
    assert tracks[0].first_seen_ms == 0
    assert tracks[0].last_seen_ms == 100
    assert tracks[0].appearance_count == 2


def test_yolo_runtime_uses_midpoint_frame_bbox_but_keeps_max_track_confidence(tmp_path) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeMovingTrackModel()

    tracks = runtime.track_video(video_path, fps=10, media_width=100, media_height=80)

    assert len(tracks) == 1
    assert tracks[0].confidence == 0.95
    assert tracks[0].bbox == YoloBBox(x=51.0, y=2.0, width=10.0, height=20.0)
    assert tracks[0].first_seen_ms == 0
    assert tracks[0].last_seen_ms == 200
    assert tracks[0].appearance_count == 3


def test_yolo_runtime_reports_actual_processed_frames_from_one_to_total(tmp_path) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeMovingTrackModel()
    updates = []

    runtime.track_video(
        video_path,
        fps=10,
        media_width=100,
        media_height=80,
        total_frames=3,
        progress_callback=lambda stage, processed, total, force: updates.append((stage, processed, total, force)),
    )

    assert [(item[1], item[2]) for item in updates] == [(1, 3), (2, 3), (3, 3)]


def test_progress_reporter_throttles_updates_and_callback_failure_is_non_fatal(monkeypatch) -> None:
    calls = []
    now = [0.0]

    class Response:
        def raise_for_status(self):
            return None

    monkeypatch.setattr("app.services.video_progress.httpx.post", lambda *args, **kwargs: calls.append(kwargs["json"]) or Response())
    reporter = VideoProgressReporter(job_id=7, min_interval_seconds=999, clock=lambda: now[0])
    reporter.report("ANALYZING", 1, 100, force=True)
    reporter.report("ANALYZING", 2, 100)
    reporter.report("ANALYZING", 100, 100, force=True)
    assert [call["processed_frames"] for call in calls] == [1, 100]

    def fail(*args, **kwargs):
        import httpx
        raise httpx.ConnectError("offline")

    monkeypatch.setattr("app.services.video_progress.httpx.post", fail)
    reporter.report("RENDERING", None, 100, force=True)


def test_progress_reporter_backs_off_failure_storm_and_retries_latest_snapshot(monkeypatch) -> None:
    attempts = []
    now = [0.0]

    def fail(*args, **kwargs):
        attempts.append(kwargs["json"])
        raise httpx.ConnectError("offline")

    monkeypatch.setattr("app.services.video_progress.httpx.post", fail)
    reporter = VideoProgressReporter(job_id=8, failure_backoff_seconds=2.0, clock=lambda: now[0])

    for processed_frames in range(1, 101):
        reporter.report("ANALYZING", processed_frames, 100, force=processed_frames == 1)
        now[0] += 0.01

    assert [attempt["processed_frames"] for attempt in attempts] == [1]

    now[0] = 2.1
    reporter.report("ANALYZING", 100, 100)

    assert [attempt["processed_frames"] for attempt in attempts] == [1, 100]


def test_progress_reporter_recovers_to_normal_throttle_and_uses_short_timeout(monkeypatch) -> None:
    calls = []
    outcomes = iter([False, True, True])
    now = [0.0]

    class Response:
        def raise_for_status(self):
            return None

    def post(*args, **kwargs):
        calls.append(kwargs)
        if not next(outcomes):
            now[0] = 0.5
            raise httpx.ConnectError("offline")
        return Response()

    monkeypatch.setattr("app.services.video_progress.httpx.post", post)
    reporter = VideoProgressReporter(job_id=9, clock=lambda: now[0])
    reporter.report("ANALYZING", 1, 100, force=True)
    assert reporter.last_attempt_at == 0.0
    assert reporter.next_retry_at == 2.5

    now[0] = 0.6
    reporter.report("ANALYZING", 10, 100, force=True)
    now[0] = 0.7
    reporter.report("RENDERING", None, 100, force=True)
    assert len(calls) == 1

    now[0] = 2.5
    reporter.report("ANALYZING", 50, 100)
    now[0] = 2.6
    reporter.report("ANALYZING", 60, 100)
    now[0] = 3.0
    reporter.report("ANALYZING", 60, 100)

    assert [call["json"]["processed_frames"] for call in calls] == [1, 50, 60]
    assert all(call["timeout"] == 0.5 for call in calls)
    assert reporter.last_percent == 60
    assert reporter.next_retry_at == 0.0


def test_yolo_runtime_midpoint_tie_prefers_higher_confidence_frame(tmp_path) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeEqualDistanceConfidenceTieBreakModel()

    tracks = runtime.track_video(video_path, fps=10, media_width=100, media_height=80)

    assert tracks[0].confidence == 0.90
    assert tracks[0].bbox == YoloBBox(x=71.0, y=2.0, width=10.0, height=20.0)


def test_yolo_runtime_midpoint_tie_prefers_earlier_frame_after_confidence(tmp_path) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeEqualDistanceFrameTieBreakModel()

    tracks = runtime.track_video(video_path, fps=10, media_width=100, media_height=80)

    assert tracks[0].confidence == 0.80
    assert tracks[0].bbox == YoloBBox(x=1.0, y=2.0, width=10.0, height=20.0)


def test_yolo_runtime_drops_untracked_detections_and_keeps_distinct_track_ids(tmp_path) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeMultipleTrackModel()

    tracks = runtime.track_video(video_path, fps=10, media_width=100, media_height=80)

    assert [track.track_id for track in tracks] == [7, 8]
    assert [track.model_label for track in tracks] == ["bag", "trash"]
    assert all(track.track_id is not None for track in tracks)
    assert tracks[0].appearance_count == 2
    assert tracks[1].appearance_count == 2


class FakeVideoWriter:
    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.opened = True

    def isOpened(self) -> bool:
        return self.opened

    def write(self, _frame) -> None:
        self.path.write_bytes(b"opencv-rendered-mp4")

    def release(self) -> None:
        self.opened = False


def test_yolo_runtime_transcodes_rendered_video_to_browser_h264(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video_path = tmp_path / "sample.mp4"
    result_path = tmp_path / "result.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeTrackModel()
    fake_cv2 = types.SimpleNamespace(
        VideoWriter=lambda path, *_args: FakeVideoWriter(path),
        VideoWriter_fourcc=lambda *_codec: 0,
    )
    captured: dict[str, object] = {}

    def fake_fourcc(*codec):
        captured["intermediate_codec"] = "".join(codec)
        return 0

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        Path(command[-1]).write_bytes(b"h264-yuv420p-faststart")
        return subprocess.CompletedProcess(command, 0, b"", b"")

    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    fake_cv2.VideoWriter_fourcc = fake_fourcc
    monkeypatch.setattr("app.services.yolo_runtime._ffmpeg_executable", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.yolo_runtime.subprocess.run", fake_run)

    progress_updates = []
    tracks = runtime.track_video(
        video_path,
        fps=10,
        media_width=100,
        media_height=80,
        rendered_video_path=result_path,
        total_frames=300,
        progress_callback=lambda stage, processed, total, force: progress_updates.append((stage, processed, total, force)),
    )

    assert tracks
    assert captured["intermediate_codec"] == "mp4v"
    assert result_path.read_bytes() == b"h264-yuv420p-faststart"
    assert not (tmp_path / "result-opencv.mp4").exists()
    command = captured["command"]
    assert command[command.index("-c:v") + 1] == "libx264"
    assert command[command.index("-pix_fmt") + 1] == "yuv420p"
    assert command[command.index("-movflags") + 1] == "+faststart"
    assert captured["kwargs"]["capture_output"] is True
    assert progress_updates[-2:] == [("ANALYZING", 4, 300, True), ("RENDERING", None, 300, True)]
    assert progress_updates[-2][1] != progress_updates[-2][2]


def test_yolo_runtime_render_failure_cleans_intermediate_video(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video_path = tmp_path / "sample.mp4"
    result_path = tmp_path / "result.mp4"
    video_path.write_bytes(b"fake")
    runtime = YoloRuntime(model_path="fake.pt", confidence=0.5, imgsz=640)
    runtime._model = FakeTrackModel()
    fake_cv2 = types.SimpleNamespace(
        VideoWriter=lambda path, *_args: FakeVideoWriter(path),
        VideoWriter_fourcc=lambda *_codec: 0,
    )

    def fail_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 1, b"", b"failed")

    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    monkeypatch.setattr("app.services.yolo_runtime._ffmpeg_executable", lambda: "ffmpeg")
    monkeypatch.setattr("app.services.yolo_runtime.subprocess.run", fail_run)

    from app.services.yolo_runtime import YoloRuntimeUnavailableError

    with pytest.raises(YoloRuntimeUnavailableError):
        runtime.track_video(video_path, fps=10, media_width=100, media_height=80, rendered_video_path=result_path)

    assert not result_path.exists()
    assert not (tmp_path / "result-opencv.mp4").exists()
