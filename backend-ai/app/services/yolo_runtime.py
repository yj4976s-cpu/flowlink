from __future__ import annotations

import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from shutil import which
from threading import Lock
from collections.abc import Callable

from PIL import Image

from app.core.config import BACKEND_AI_DIR, REPO_ROOT, get_settings

INTERMEDIATE_VIDEO_CODEC = "mp4v"


@dataclass(frozen=True)
class YoloBBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class YoloPrediction:
    model_label: str
    confidence: float
    bbox: YoloBBox


@dataclass(frozen=True)
class YoloTrackPrediction:
    model_label: str
    confidence: float
    bbox: YoloBBox
    track_id: int | None
    first_seen_ms: int
    last_seen_ms: int
    appearance_count: int


@dataclass(frozen=True)
class YoloTrackObservation:
    prediction: YoloTrackPrediction
    frame_index: int


class YoloRuntimeUnavailableError(RuntimeError):
    pass


class YoloRuntime:
    def __init__(
        self,
        *,
        model_path: str,
        confidence: float,
        imgsz: int,
        model_id: str | None = None,
        display_name: str | None = None,
        expected_classes: list[str] | None = None,
    ) -> None:
        self.model_path = model_path
        self.confidence = confidence
        self.imgsz = imgsz
        self.model_id = model_id
        self.display_name = display_name
        self.expected_classes = expected_classes or []
        self._model: object | None = None
        self._model_lock = Lock()
        self._inference_lock = Lock()
        self._validated_classes: tuple[str, ...] | None = None

    def validate_ready(self, *, expected_classes: list[str] | None = None) -> None:
        model = self._get_model()
        classes = expected_classes or self.expected_classes
        normalized_expected = tuple(sorted(classes))
        if self._validated_classes == normalized_expected:
            return
        if classes:
            from app.services.model_registry import validate_model_class_names

            names = getattr(model, "names", {})
            if not validate_model_class_names(names, classes):
                raise YoloRuntimeUnavailableError("YOLO detection model class names do not match registry")
        with self._inference_lock:
            try:
                results = model.predict(source=Image.new("RGB", (32, 32), color=(255, 255, 255)), conf=self.confidence, imgsz=self.imgsz, verbose=False)
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO detection model warm-up failed") from exc
        if not isinstance(results, (list, tuple)) or not results or not hasattr(results[0], "boxes"):
            raise YoloRuntimeUnavailableError("YOLO detection model warm-up returned an invalid result")
        self._validated_classes = normalized_expected

    def predict(self, image: Image.Image) -> list[YoloPrediction]:
        model = self._get_model()
        with self._inference_lock:
            try:
                results = model.predict(source=image, conf=self.confidence, imgsz=self.imgsz, verbose=False)
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO detection model is unavailable") from exc
        return self._parse_result(model, results[0] if results else None, image.width, image.height)

    def track_video(
        self,
        video_path: Path,
        *,
        fps: float,
        media_width: int,
        media_height: int,
        rendered_video_path: Path | None = None,
        total_frames: int | None = None,
        progress_callback: Callable[[str, int | None, int | None, bool], None] | None = None,
    ) -> list[YoloTrackPrediction]:
        model = self._get_model()
        observations: dict[tuple[str, int | None], list[YoloTrackObservation]] = {}
        writer = None
        intermediate_video_path: Path | None = None
        frames_written = 0
        processed_frame_count = 0
        with self._inference_lock:
            tracking_error: Exception | None = None
            try:
                if rendered_video_path is not None:
                    import cv2

                    intermediate_video_path = rendered_video_path.with_name(
                        f"{rendered_video_path.stem}-opencv{rendered_video_path.suffix}"
                    )
                    candidate = cv2.VideoWriter(
                        str(intermediate_video_path),
                        cv2.VideoWriter_fourcc(*INTERMEDIATE_VIDEO_CODEC),
                        fps,
                        (media_width, media_height),
                    )
                    if candidate.isOpened():
                        writer = candidate
                    else:
                        candidate.release()
                    if writer is None:
                        raise RuntimeError("Rendered video writer could not be opened")
                results = model.track(
                    source=str(video_path),
                    tracker="bytetrack.yaml",
                    stream=True,
                    persist=False,
                    conf=self.confidence,
                    imgsz=self.imgsz,
                    verbose=False,
                )
                for frame_index, result in enumerate(results):
                    processed_frame_count = frame_index + 1
                    if writer is not None:
                        writer.write(result.plot())
                        frames_written += 1
                    frame_seen_ms = int(round((frame_index / fps) * 1000))
                    for prediction in self._parse_track_result(
                        model,
                        result,
                        media_width,
                        media_height,
                        seen_ms=frame_seen_ms,
                    ):
                        if prediction.track_id is None:
                            continue
                        key = (prediction.model_label, prediction.track_id)
                        observations.setdefault(key, []).append(
                            YoloTrackObservation(prediction=prediction, frame_index=frame_index)
                        )
                    if progress_callback is not None:
                        progress_callback("ANALYZING", processed_frame_count, total_frames, False)
            except Exception as exc:
                tracking_error = exc
            finally:
                if writer is not None:
                    writer.release()
            if tracking_error is not None:
                if intermediate_video_path is not None:
                    intermediate_video_path.unlink(missing_ok=True)
                if rendered_video_path is not None:
                    rendered_video_path.unlink(missing_ok=True)
                raise YoloRuntimeUnavailableError("YOLO video tracking model is unavailable") from tracking_error
            if rendered_video_path is not None:
                try:
                    if intermediate_video_path is None or frames_written <= 0:
                        raise RuntimeError("Rendered video contains no frames")
                    if progress_callback is not None:
                        progress_callback("ANALYZING", processed_frame_count, total_frames, True)
                        progress_callback("RENDERING", None, total_frames, True)
                    _transcode_h264_mp4(intermediate_video_path, rendered_video_path)
                except Exception as exc:
                    raise YoloRuntimeUnavailableError("YOLO video tracking model is unavailable") from exc
                finally:
                    if intermediate_video_path is not None:
                        intermediate_video_path.unlink(missing_ok=True)
        return sorted(
            _aggregate_track_observations(observations),
            key=lambda prediction: (
                prediction.first_seen_ms,
                prediction.track_id if prediction.track_id is not None else 10**12,
                -prediction.confidence,
            ),
        )

    def _get_model(self):
        if self._model is not None:
            return self._model
        with self._model_lock:
            if self._model is not None:
                return self._model
            try:
                from ultralytics import YOLO

                self._model = YOLO(self._resolve_model_source())
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO detection model is unavailable") from exc
            return self._model

    def _resolve_model_source(self) -> str:
        configured = Path(self.model_path)
        if configured.is_absolute():
            return str(configured)
        candidates = [
            (BACKEND_AI_DIR / configured).resolve(),
            (REPO_ROOT / configured).resolve(),
        ]
        if len(configured.parts) == 1:
            candidates.extend(
                [
                    (BACKEND_AI_DIR / "models" / configured).resolve(),
                    (REPO_ROOT / "models" / configured).resolve(),
                    (REPO_ROOT / "ai" / configured).resolve(),
                ]
            )
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return self.model_path

    def _parse_result(self, model, result, media_width: int, media_height: int) -> list[YoloPrediction]:
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []

        names = getattr(model, "names", {})
        predictions: list[YoloPrediction] = []
        for box in boxes:
            xyxy = box.xyxy[0].tolist()
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])
            model_label = names.get(class_id, str(class_id)) if isinstance(names, dict) else str(class_id)
            x1, y1, x2, y2 = [float(value) for value in xyxy]
            left = max(0.0, min(x1, float(media_width)))
            top = max(0.0, min(y1, float(media_height)))
            right = max(left, min(x2, float(media_width)))
            bottom = max(top, min(y2, float(media_height)))
            predictions.append(
                YoloPrediction(
                    model_label=model_label,
                    confidence=confidence,
                    bbox=YoloBBox(
                        x=left,
                        y=top,
                        width=right - left,
                        height=bottom - top,
                    ),
                )
            )
        return predictions

    def _parse_track_result(
        self,
        model,
        result,
        media_width: int,
        media_height: int,
        *,
        seen_ms: int,
    ) -> list[YoloTrackPrediction]:
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []

        names = getattr(model, "names", {})
        predictions: list[YoloTrackPrediction] = []
        for box in boxes:
            xyxy = box.xyxy[0].tolist()
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])
            model_label = names.get(class_id, str(class_id)) if isinstance(names, dict) else str(class_id)
            x1, y1, x2, y2 = [float(value) for value in xyxy]
            left = max(0.0, min(x1, float(media_width)))
            top = max(0.0, min(y1, float(media_height)))
            right = max(left, min(x2, float(media_width)))
            bottom = max(top, min(y2, float(media_height)))
            predictions.append(
                YoloTrackPrediction(
                    model_label=model_label,
                    confidence=confidence,
                    bbox=YoloBBox(
                        x=left,
                        y=top,
                        width=right - left,
                        height=bottom - top,
                    ),
                    track_id=self._parse_track_id(box),
                    first_seen_ms=seen_ms,
                    last_seen_ms=seen_ms,
                    appearance_count=1,
                )
            )
        return predictions

    def _parse_track_id(self, box) -> int | None:
        raw_track_id = getattr(box, "id", None)
        if raw_track_id is None:
            return None
        try:
            if hasattr(raw_track_id, "numel") and raw_track_id.numel() == 0:
                return None
            if hasattr(raw_track_id, "tolist"):
                value = raw_track_id.tolist()
                if isinstance(value, list):
                    return int(value[0]) if value else None
                return int(value)
            return int(raw_track_id[0])
        except (TypeError, ValueError, IndexError):
            return None


@lru_cache
def get_yolo_runtime() -> YoloRuntime:
    settings = get_settings()
    return YoloRuntime(
        model_path=settings.DETECTION_MODEL,
        confidence=settings.DETECTION_CONFIDENCE,
        imgsz=settings.DETECTION_IMGSZ,
        model_id=Path(settings.DETECTION_MODEL).stem,
    )


def _ffmpeg_executable() -> str:
    system_ffmpeg = which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise RuntimeError("FFmpeg executable is not available") from exc
    return imageio_ffmpeg.get_ffmpeg_exe()


def _transcode_h264_mp4(input_path: Path, output_path: Path) -> None:
    if not input_path.exists() or input_path.stat().st_size == 0:
        raise RuntimeError("Rendered intermediate video was not created")
    output_path.unlink(missing_ok=True)
    completed = subprocess.run(
        [
            _ffmpeg_executable(),
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("FFmpeg H.264 conversion failed")
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not create a rendered video")


def _aggregate_track_observations(
    observations_by_track: dict[tuple[str, int | None], list[YoloTrackObservation]],
) -> list[YoloTrackPrediction]:
    predictions: list[YoloTrackPrediction] = []
    for observations in observations_by_track.values():
        if not observations:
            continue
        seen_ms_values = [observation.prediction.first_seen_ms for observation in observations]
        first_seen_ms = min(seen_ms_values)
        last_seen_ms = max(seen_ms_values)
        midpoint_ms = (first_seen_ms + last_seen_ms) / 2
        max_confidence = max(observation.prediction.confidence for observation in observations)
        representative = min(
            observations,
            key=lambda observation: (
                abs(observation.prediction.first_seen_ms - midpoint_ms),
                -observation.prediction.confidence,
                observation.frame_index,
            ),
        ).prediction
        predictions.append(
            YoloTrackPrediction(
                model_label=representative.model_label,
                confidence=max_confidence,
                bbox=representative.bbox,
                track_id=representative.track_id,
                first_seen_ms=first_seen_ms,
                last_seen_ms=last_seen_ms,
                appearance_count=len(observations),
            )
        )
    return predictions
