from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError


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
    rendered_video: bytes | None = None


class DetectionInferenceUnavailableError(RuntimeError):
    pass


MODEL_LABEL_TO_CLASS_CODE = {
    "bag": "BAG",
    "backpack": "BAG",
    "handbag": "BAG",
    "suitcase": "BAG",
    "umbrella": "UMBRELLA",
    "ball": "BALL",
    "sports ball": "BALL",
    "footwear": "FOOTWEAR",
    "shoe": "FOOTWEAR",
    "sneaker": "FOOTWEAR",
    "bottle": "TRASH",
    "cup": "TRASH",
}
KNOWN_CLASS_CODES = {"TRASH", "BRANCH", "AQUATIC_PLANT", "BALL", "BAG", "UMBRELLA", "FOOTWEAR"}
SAME_CLASS_OVERLAP_THRESHOLD = 0.5


def model_label_to_class_code(label: str) -> str | None:
    normalized = label.strip().lower().replace("_", " ")
    direct_code = normalized.upper().replace(" ", "_")
    if direct_code in KNOWN_CLASS_CODES:
        return direct_code
    return MODEL_LABEL_TO_CLASS_CODE.get(normalized)


def bbox_iou(first: DetectionBBox, second: DetectionBBox) -> float:
    first_right = first.x + first.width
    first_bottom = first.y + first.height
    second_right = second.x + second.width
    second_bottom = second.y + second.height

    intersection_width = max(0.0, min(first_right, second_right) - max(first.x, second.x))
    intersection_height = max(0.0, min(first_bottom, second_bottom) - max(first.y, second.y))
    intersection_area = intersection_width * intersection_height
    if intersection_area == 0:
        return 0.0

    first_area = max(0.0, first.width) * max(0.0, first.height)
    second_area = max(0.0, second.width) * max(0.0, second.height)
    union_area = first_area + second_area - intersection_area
    if union_area <= 0:
        return 0.0
    return intersection_area / union_area


def deduplicate_same_class_detections(detections: list[DetectionPrediction]) -> list[DetectionPrediction]:
    kept: list[DetectionPrediction] = []
    for detection in sorted(detections, key=lambda item: item.confidence, reverse=True):
        if any(
            existing.class_code == detection.class_code
            and bbox_iou(existing.bbox, detection.bbox) >= SAME_CLASS_OVERLAP_THRESHOLD
            for existing in kept
        ):
            continue
        kept.append(detection)
    return sorted(kept, key=lambda item: item.confidence, reverse=True)


class DetectionInferenceService:
    def __init__(self, *, ai_client=None) -> None:
        if ai_client is None:
            from app.services.ai_inference_client import get_ai_inference_client

            ai_client = get_ai_inference_client()
        self.ai_client = ai_client

    def analyze_image(self, media_path: Path) -> DetectionInferenceResult:
        from app.services.ai_inference_client import AIInferenceUnavailableError

        try:
            with Image.open(media_path) as image:
                image.load()
        except (UnidentifiedImageError, OSError) as exc:
            raise RuntimeError("AI detection image could not be decoded") from exc

        try:
            result = self.ai_client.infer_image_file(media_path)
        except AIInferenceUnavailableError as exc:
            raise DetectionInferenceUnavailableError("AI detection model is not configured") from exc
        except RuntimeError as exc:
            raise RuntimeError("AI detection image could not be decoded") from exc

        detections: list[DetectionPrediction] = []
        for prediction in result.predictions:
            class_code = model_label_to_class_code(prediction.model_label)
            if class_code is None:
                continue
            detections.append(
                DetectionPrediction(
                    class_code=class_code,
                    confidence=prediction.confidence,
                    bbox=prediction.bbox,
                )
            )
        return DetectionInferenceResult(
            media_width=result.media_width,
            media_height=result.media_height,
            detections=deduplicate_same_class_detections(detections),
        )

    def analyze_video(self, media_path: Path, *, video_job_id: int | None = None) -> DetectionInferenceResult:
        from app.services.ai_inference_client import AIInferenceUnavailableError

        try:
            result = self.ai_client.infer_video_file(media_path, video_job_id=video_job_id) if video_job_id is not None else self.ai_client.infer_video_file(media_path)
        except AIInferenceUnavailableError as exc:
            raise DetectionInferenceUnavailableError("AI detection model is not configured") from exc
        except RuntimeError as exc:
            raise RuntimeError("AI detection video could not be decoded") from exc

        detections: list[DetectionPrediction] = []
        for track in result.tracks:
            class_code = model_label_to_class_code(track.model_label)
            if class_code is None:
                continue
            detections.append(
                DetectionPrediction(
                    class_code=class_code,
                    confidence=track.confidence,
                    bbox=track.bbox,
                    track_id=track.track_id,
                    first_seen_ms=track.first_seen_ms,
                    last_seen_ms=track.last_seen_ms,
                    appearance_count=track.appearance_count,
                )
            )
        return DetectionInferenceResult(
            media_width=result.media_width,
            media_height=result.media_height,
            detections=detections,
            rendered_video=result.rendered_video,
        )


def get_inference_service() -> DetectionInferenceService:
    return DetectionInferenceService()
