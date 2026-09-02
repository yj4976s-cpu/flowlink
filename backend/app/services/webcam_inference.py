from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from PIL import Image

from app.services.detection_inference import DetectionBBox, model_label_to_class_code


WEBCAM_CLASS_METADATA: dict[str, tuple[str, str]] = {
    "TRASH": ("폐기물", "WASTE"),
    "BRANCH": ("나뭇가지", "NATURAL"),
    "AQUATIC_PLANT": ("수초", "NATURAL"),
    "BAG": ("가방", "PERSONAL_ITEM"),
    "UMBRELLA": ("우산", "PERSONAL_ITEM"),
    "FOOTWEAR": ("신발", "PERSONAL_ITEM"),
    "BALL": ("공", "PERSONAL_ITEM"),
}


@dataclass(frozen=True)
class WebcamDetectionObject:
    label: str
    confidence: float
    bbox: DetectionBBox
    class_code: str | None = None
    class_name_ko: str | None = None
    group_code: str | None = None
    track_id: int | None = None
    first_seen_ms: int | None = None
    last_seen_ms: int | None = None
    appearance_count: int = 1


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

    def analyze_frame(self, image: Image.Image, *, session_id: str = "legacy") -> WebcamDetectionFrame:
        try:
            result = self.ai_client.track_webcam_frame(image, session_id=session_id)
        except RuntimeError as exc:
            raise WebcamInferenceUnavailableError("Webcam detection model is unavailable") from exc
        return WebcamDetectionFrame(
            media_width=result.media_width,
            media_height=result.media_height,
            inference_ms=result.inference_ms,
            detected_objects=[
                WebcamDetectionObject(
                    label=prediction.model_label,
                    class_code=class_code,
                    class_name_ko=metadata[0] if metadata else None,
                    group_code=metadata[1] if metadata else None,
                    confidence=prediction.confidence,
                    bbox=prediction.bbox,
                    track_id=prediction.track_id,
                    first_seen_ms=prediction.first_seen_ms,
                    last_seen_ms=prediction.last_seen_ms,
                    appearance_count=prediction.appearance_count,
                )
                for prediction in result.tracks
                for class_code in [model_label_to_class_code(prediction.model_label)]
                for metadata in [WEBCAM_CLASS_METADATA.get(class_code) if class_code else None]
            ],
        )


@lru_cache
def get_webcam_inference_service() -> WebcamInferenceService:
    from app.services.ai_inference_client import get_ai_inference_client

    return WebcamInferenceService(ai_client=get_ai_inference_client())
