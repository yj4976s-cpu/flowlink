from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from time import perf_counter

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings
from app.schemas.inference import ImageInferenceResponse, InferenceBBox, InferencePrediction
from app.services.yolo_runtime import YoloRuntime, YoloRuntimeUnavailableError, get_yolo_runtime

IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


class InferenceModelUnavailableError(RuntimeError):
    pass


class ImageInferenceService:
    def __init__(self, *, runtime: YoloRuntime) -> None:
        self.runtime = runtime

    def analyze_image_bytes(self, payload: bytes, *, content_type: str) -> ImageInferenceResponse:
        settings = get_settings()
        if content_type not in IMAGE_CONTENT_TYPES:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported media type")
        if not payload:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
        if len(payload) > settings.IMAGE_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded file is too large")

        try:
            with Image.open(BytesIO(payload)) as image:
                image.load()
                width, height = image.size
                if width <= 0 or height <= 0:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image dimensions")
                if width * height > settings.IMAGE_MAX_PIXELS:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail="Uploaded image dimensions are too large",
                    )
                rgb_image = image.convert("RGB")
        except HTTPException:
            raise
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image") from exc

        started_at = perf_counter()
        try:
            predictions = self.runtime.predict(rgb_image)
        except YoloRuntimeUnavailableError as exc:
            raise InferenceModelUnavailableError("AI model is unavailable") from exc
        inference_ms = (perf_counter() - started_at) * 1000

        return ImageInferenceResponse(
            media_width=rgb_image.width,
            media_height=rgb_image.height,
            inference_ms=round(inference_ms, 2),
            predictions=[
                InferencePrediction(
                    label=prediction.model_label,
                    confidence=prediction.confidence,
                    bbox=InferenceBBox(
                        x=prediction.bbox.x,
                        y=prediction.bbox.y,
                        width=prediction.bbox.width,
                        height=prediction.bbox.height,
                    ),
                )
                for prediction in predictions
            ],
        )


@lru_cache
def get_inference_service() -> ImageInferenceService:
    return ImageInferenceService(runtime=get_yolo_runtime())

