from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from time import perf_counter

from PIL import Image

from app.services.detection_inference import DetectionBBox
from app.services.yolo_runtime import YoloRuntime, YoloRuntimeUnavailableError, get_yolo_runtime


@dataclass(frozen=True)
class WebcamDetectionObject:
    label: str
    confidence: float
    bbox: DetectionBBox


@dataclass(frozen=True)
class WebcamDetectionFrame:
    media_width: int
    media_height: int
    inference_ms: float
    detected_objects: list[WebcamDetectionObject]


class WebcamInferenceUnavailableError(RuntimeError):
    pass


# Live inference is isolated from persistence so this service can move to the AI runtime independently.
class WebcamInferenceService:
    def __init__(self, *, runtime: YoloRuntime) -> None:
        self.runtime = runtime

    def analyze_frame(self, image: Image.Image) -> WebcamDetectionFrame:
        media_width, media_height = image.size
        started_at = perf_counter()
        try:
            predictions = self.runtime.predict(image)
        except YoloRuntimeUnavailableError as exc:
            raise WebcamInferenceUnavailableError("Webcam detection model is unavailable") from exc
        inference_ms = (perf_counter() - started_at) * 1000
        return WebcamDetectionFrame(
            media_width=media_width,
            media_height=media_height,
            inference_ms=round(inference_ms, 2),
            detected_objects=[
                WebcamDetectionObject(
                    label=prediction.model_label,
                    confidence=prediction.confidence,
                    bbox=prediction.bbox,
                )
                for prediction in predictions
            ],
        )


@lru_cache
def get_webcam_inference_service() -> WebcamInferenceService:
    return WebcamInferenceService(runtime=get_yolo_runtime())
