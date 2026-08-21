from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock

from PIL import Image

from app.core.config import BACKEND_AI_DIR, REPO_ROOT, get_settings


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


class YoloRuntimeUnavailableError(RuntimeError):
    pass


class YoloRuntime:
    def __init__(self, *, model_path: str, confidence: float, imgsz: int) -> None:
        self.model_path = model_path
        self.confidence = confidence
        self.imgsz = imgsz
        self._model: object | None = None
        self._model_lock = Lock()
        self._inference_lock = Lock()

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
    ) -> list[YoloTrackPrediction]:
        model = self._get_model()
        tracked: dict[tuple[str, int | None], YoloTrackPrediction] = {}
        writer = None
        with self._inference_lock:
            try:
                if rendered_video_path is not None:
                    import cv2

                    for codec in ("avc1", "mp4v"):
                        candidate = cv2.VideoWriter(
                            str(rendered_video_path),
                            cv2.VideoWriter_fourcc(*codec),
                            fps,
                            (media_width, media_height),
                        )
                        if candidate.isOpened():
                            writer = candidate
                            break
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
                    if writer is not None:
                        writer.write(result.plot())
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
                        previous = tracked.get(key)
                        if previous is None:
                            tracked[key] = prediction
                            continue
                        tracked[key] = YoloTrackPrediction(
                            model_label=previous.model_label,
                            confidence=max(previous.confidence, prediction.confidence),
                            bbox=prediction.bbox if prediction.confidence >= previous.confidence else previous.bbox,
                            track_id=previous.track_id,
                            first_seen_ms=min(previous.first_seen_ms, prediction.first_seen_ms),
                            last_seen_ms=max(previous.last_seen_ms, prediction.last_seen_ms),
                            appearance_count=previous.appearance_count + 1,
                        )
            except Exception as exc:
                raise YoloRuntimeUnavailableError("YOLO video tracking model is unavailable") from exc
            finally:
                if writer is not None:
                    writer.release()
        return sorted(
            tracked.values(),
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
    )
