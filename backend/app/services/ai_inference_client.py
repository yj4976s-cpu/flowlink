from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image
from pydantic import BaseModel, Field, ValidationError

from app.core.config import get_settings


class AIInferenceUnavailableError(RuntimeError):
    pass


class AIInferenceRejectedError(RuntimeError):
    pass


class AIInferenceBBoxResponse(BaseModel):
    x: float
    y: float
    width: float
    height: float


class AIInferencePredictionResponse(BaseModel):
    label: str
    confidence: float
    bbox: AIInferenceBBoxResponse


class AIInferenceVideoTrackResponse(BaseModel):
    label: str
    confidence: float
    bbox: AIInferenceBBoxResponse
    track_id: int | None
    first_seen_ms: int
    last_seen_ms: int
    appearance_count: int = Field(ge=1)


class AIInferenceResponse(BaseModel):
    media_width: int
    media_height: int
    inference_ms: float = Field(ge=0)
    predictions: list[AIInferencePredictionResponse] = Field(default_factory=list)


class AIInferenceVideoResponse(BaseModel):
    media_width: int
    media_height: int
    duration_ms: int = Field(ge=0)
    frame_count: int = Field(ge=1)
    fps: float = Field(gt=0)
    inference_ms: float = Field(ge=0)
    tracks: list[AIInferenceVideoTrackResponse] = Field(default_factory=list)


@dataclass(frozen=True)
class AIInferenceBBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class AIInferencePrediction:
    model_label: str
    confidence: float
    bbox: AIInferenceBBox


@dataclass(frozen=True)
class AIInferenceVideoTrack:
    model_label: str
    confidence: float
    bbox: AIInferenceBBox
    track_id: int | None
    first_seen_ms: int
    last_seen_ms: int
    appearance_count: int


@dataclass(frozen=True)
class AIInferenceResult:
    media_width: int
    media_height: int
    inference_ms: float
    predictions: list[AIInferencePrediction]


@dataclass(frozen=True)
class AIInferenceVideoResult:
    media_width: int
    media_height: int
    duration_ms: int
    frame_count: int
    fps: float
    inference_ms: float
    tracks: list[AIInferenceVideoTrack]


class AIInferenceClient:
    def __init__(self, *, base_url: str, internal_api_key: str, timeout_seconds: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.internal_api_key = internal_api_key
        self.timeout_seconds = timeout_seconds

    def infer_image_file(self, media_path: Path) -> AIInferenceResult:
        content_type = _content_type_for_path(media_path)
        return self.infer_image_bytes(
            media_path.read_bytes(),
            filename=media_path.name,
            content_type=content_type,
        )

    def infer_video_file(self, media_path: Path) -> AIInferenceVideoResult:
        if not self.base_url or not self.internal_api_key:
            raise AIInferenceUnavailableError("AI inference service is unavailable")

        try:
            with media_path.open("rb") as payload:
                response = httpx.post(
                    f"{self.base_url}/api/inference/videos",
                    headers={"X-Internal-API-Key": self.internal_api_key},
                    files={"file": (media_path.name, payload, "video/mp4")},
                    timeout=self.timeout_seconds,
                )
        except OSError as exc:
            raise AIInferenceRejectedError("AI inference video file could not be opened") from exc
        except httpx.RequestError as exc:
            raise AIInferenceUnavailableError("AI inference service is unavailable") from exc

        if response.status_code in {401, 403, 503} or response.status_code >= 500:
            raise AIInferenceUnavailableError("AI inference service is unavailable")
        if response.status_code >= 400:
            raise AIInferenceRejectedError("AI inference request was rejected")

        try:
            parsed = AIInferenceVideoResponse.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise AIInferenceUnavailableError("AI inference service returned an invalid response") from exc

        return AIInferenceVideoResult(
            media_width=parsed.media_width,
            media_height=parsed.media_height,
            duration_ms=parsed.duration_ms,
            frame_count=parsed.frame_count,
            fps=parsed.fps,
            inference_ms=parsed.inference_ms,
            tracks=[
                AIInferenceVideoTrack(
                    model_label=track.label,
                    confidence=track.confidence,
                    bbox=AIInferenceBBox(
                        x=track.bbox.x,
                        y=track.bbox.y,
                        width=track.bbox.width,
                        height=track.bbox.height,
                    ),
                    track_id=track.track_id,
                    first_seen_ms=track.first_seen_ms,
                    last_seen_ms=track.last_seen_ms,
                    appearance_count=track.appearance_count,
                )
                for track in parsed.tracks
            ],
        )

    def infer_image(self, image: Image.Image) -> AIInferenceResult:
        payload = BytesIO()
        image.convert("RGB").save(payload, format="JPEG", quality=90)
        return self.infer_image_bytes(
            payload.getvalue(),
            filename="webcam-frame.jpg",
            content_type="image/jpeg",
        )

    def infer_image_bytes(self, payload: bytes, *, filename: str, content_type: str) -> AIInferenceResult:
        if not self.base_url or not self.internal_api_key:
            raise AIInferenceUnavailableError("AI inference service is unavailable")

        try:
            response = httpx.post(
                f"{self.base_url}/api/inference/images",
                headers={"X-Internal-API-Key": self.internal_api_key},
                files={"file": (filename, payload, content_type)},
                timeout=self.timeout_seconds,
            )
        except httpx.RequestError as exc:
            raise AIInferenceUnavailableError("AI inference service is unavailable") from exc

        if response.status_code in {401, 403, 503} or response.status_code >= 500:
            raise AIInferenceUnavailableError("AI inference service is unavailable")
        if response.status_code >= 400:
            raise AIInferenceRejectedError("AI inference request was rejected")

        try:
            parsed = AIInferenceResponse.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise AIInferenceUnavailableError("AI inference service returned an invalid response") from exc

        return AIInferenceResult(
            media_width=parsed.media_width,
            media_height=parsed.media_height,
            inference_ms=parsed.inference_ms,
            predictions=[
                AIInferencePrediction(
                    model_label=prediction.label,
                    confidence=prediction.confidence,
                    bbox=AIInferenceBBox(
                        x=prediction.bbox.x,
                        y=prediction.bbox.y,
                        width=prediction.bbox.width,
                        height=prediction.bbox.height,
                    ),
                )
                for prediction in parsed.predictions
            ],
        )


def _content_type_for_path(media_path: Path) -> str:
    suffix = media_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "application/octet-stream"


@lru_cache
def get_ai_inference_client() -> AIInferenceClient:
    settings = get_settings()
    return AIInferenceClient(
        base_url=settings.AI_SERVICE_URL,
        internal_api_key=settings.AI_INTERNAL_API_KEY,
        timeout_seconds=settings.AI_SERVICE_TIMEOUT_SECONDS,
    )
