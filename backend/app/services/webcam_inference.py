from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from PIL import Image

from app.services.detection_inference import DetectionBBox


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
    def __init__(self, *, ai_client) -> None:
        self.ai_client = ai_client

    def analyze_frame(self, image: Image.Image) -> WebcamDetectionFrame:
        try:
            result = self.ai_client.infer_image(image)
        except RuntimeError as exc:
            raise WebcamInferenceUnavailableError("Webcam detection model is unavailable") from exc
        return WebcamDetectionFrame(
            media_width=result.media_width,
            media_height=result.media_height,
            inference_ms=result.inference_ms,
            detected_objects=[
                WebcamDetectionObject(
                    label=prediction.model_label,
                    confidence=prediction.confidence,
                    bbox=prediction.bbox,
                )
                for prediction in result.predictions
            ],
        )


@lru_cache
def get_webcam_inference_service() -> WebcamInferenceService:
    from app.services.ai_inference_client import get_ai_inference_client

    return WebcamInferenceService(ai_client=get_ai_inference_client())
