from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DetectionBBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class DetectionPrediction:
    class_code: str
    confidence: float
    bbox: DetectionBBox
    track_id: int | None = None
    first_seen_ms: int | None = None
    last_seen_ms: int | None = None
    appearance_count: int = 1


@dataclass(frozen=True)
class DetectionInferenceResult:
    media_width: int | None
    media_height: int | None
    detections: list[DetectionPrediction]


class DetectionInferenceUnavailableError(RuntimeError):
    pass


class DetectionInferenceService:
    def analyze_image(self, media_path: Path) -> DetectionInferenceResult:
        raise DetectionInferenceUnavailableError("AI detection model is not configured")

    def analyze_video(self, media_path: Path) -> DetectionInferenceResult:
        raise DetectionInferenceUnavailableError("AI detection model is not configured")


def get_inference_service() -> DetectionInferenceService:
    return DetectionInferenceService()
