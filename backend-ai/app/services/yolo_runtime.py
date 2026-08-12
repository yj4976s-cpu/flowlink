from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock

from PIL import Image

from app.core.config import BACKEND_AI_DIR, get_settings


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
        if len(configured.parts) > 1:
            return str((BACKEND_AI_DIR / configured).resolve())
        local_candidate = (BACKEND_AI_DIR / configured).resolve()
        return str(local_candidate) if local_candidate.exists() else self.model_path

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


@lru_cache
def get_yolo_runtime() -> YoloRuntime:
    settings = get_settings()
    return YoloRuntime(
        model_path=settings.DETECTION_MODEL,
        confidence=settings.DETECTION_CONFIDENCE,
        imgsz=settings.DETECTION_IMGSZ,
    )

