from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import httpx
from PIL import Image
from pydantic import BaseModel, Field, ValidationError

from app.core.config import get_settings


class AIInferenceUnavailableError(RuntimeError):
    pass


class AIInferenceTimeoutError(RuntimeError):
    pass


class AIInferenceRejectedError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


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
    model_id: str | None = None
    media_width: int
    media_height: int
    inference_ms: float = Field(ge=0)
    predictions: list[AIInferencePredictionResponse] = Field(default_factory=list)


class AIInferenceVideoResponse(BaseModel):
    model_id: str | None = None
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
    model_id: str | None = None


@dataclass(frozen=True)
class AIInferenceVideoResult:
    media_width: int
    media_height: int
    duration_ms: int
    frame_count: int
    fps: float
    inference_ms: float
    tracks: list[AIInferenceVideoTrack]
    rendered_video: bytes | None = None
    model_id: str | None = None


class AIInferenceClient:
    def __init__(
        self,
        *,
        base_url: str,
        internal_api_key: str,
        timeout_seconds: float,
        video_timeout_seconds: float | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.internal_api_key = internal_api_key
        self.timeout_seconds = timeout_seconds
        self.video_timeout_seconds = video_timeout_seconds if video_timeout_seconds is not None else timeout_seconds

    def infer_image_file(self, media_path: Path) -> AIInferenceResult:
        content_type = _content_type_for_path(media_path)
        return self.infer_image_bytes(
            media_path.read_bytes(),
            filename=media_path.name,
            content_type=content_type,
        )

    def infer_video_file(self, media_path: Path, *, video_job_id: int | None = None) -> AIInferenceVideoResult:
        if not self.base_url or not self.internal_api_key:
            raise AIInferenceUnavailableError("AI inference service is unavailable")

        try:
            headers = {"X-Internal-API-Key": self.internal_api_key}
            if video_job_id is not None:
                headers["X-Video-Job-ID"] = str(video_job_id)
            with media_path.open("rb") as payload:
                response = httpx.post(
                    f"{self.base_url}/api/inference/videos?render=true",
                    headers=headers,
                    files={"file": (media_path.name, payload, "video/mp4")},
                    timeout=self.video_timeout_seconds,
                )
        except OSError as exc:
            raise AIInferenceRejectedError("AI inference video file could not be opened") from exc
        except httpx.TimeoutException as exc:
            raise AIInferenceTimeoutError("AI video inference timed out") from exc
        except httpx.RequestError as exc:
            raise AIInferenceUnavailableError("AI inference service is unavailable") from exc

        if response.status_code in {401, 403, 503} or response.status_code >= 500:
            raise AIInferenceUnavailableError("AI inference service is unavailable")
        if response.status_code >= 400:
            raise AIInferenceRejectedError("AI inference request was rejected")

        try:
            if response.headers.get("content-type", "").split(";", 1)[0] == "application/zip":
                with ZipFile(BytesIO(response.content)) as bundle:
                    parsed = AIInferenceVideoResponse.model_validate_json(bundle.read("result.json"))
                    rendered_video = bundle.read("result.mp4")
                    if not rendered_video:
                        raise ValueError("rendered result video is empty")
            else:
                parsed = AIInferenceVideoResponse.model_validate(response.json())
                rendered_video = None
        except (BadZipFile, KeyError, ValueError, ValidationError) as exc:
            raise AIInferenceUnavailableError("AI inference service returned an invalid response") from exc

        return AIInferenceVideoResult(
            model_id=parsed.model_id,
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
            rendered_video=rendered_video,
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
            model_id=parsed.model_id,
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

    def get_model_deployment_status(self) -> dict:
        response = self._request_runtime("GET", "/api/runtime/models/status")
        return response.json()

    def activate_model(self, *, model_id: str, expected_active_model_id: str | None, request_id: str) -> dict:
        response = self._request_runtime(
            "POST",
            "/api/runtime/models/activate",
            json={
                "model_id": model_id,
                "expected_active_model_id": expected_active_model_id,
                "request_id": request_id,
            },
        )
        return response.json()

    def rollback_model(self, *, expected_active_model_id: str | None, request_id: str) -> dict:
        response = self._request_runtime(
            "POST",
            "/api/runtime/models/rollback",
            json={
                "expected_active_model_id": expected_active_model_id,
                "request_id": request_id,
            },
        )
        return response.json()

    def _request_runtime(self, method: str, path: str, **kwargs) -> httpx.Response:
        if not self.base_url or not self.internal_api_key:
            raise AIInferenceUnavailableError("AI model service is unavailable")
        try:
            response = httpx.request(
                method,
                f"{self.base_url}{path}",
                headers={"X-Internal-API-Key": self.internal_api_key},
                timeout=get_settings().AI_MODEL_SWITCH_TIMEOUT_SECONDS,
                **kwargs,
            )
        except httpx.RequestError as exc:
            raise AIInferenceUnavailableError("AI model service is unavailable") from exc
        if response.status_code >= 500:
            raise AIInferenceUnavailableError("AI model service is unavailable")
        if response.status_code >= 400:
            raise AIInferenceRejectedError("AI model service rejected the request", status_code=response.status_code)
        return response


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
        video_timeout_seconds=settings.AI_VIDEO_SERVICE_TIMEOUT_SECONDS,
    )
