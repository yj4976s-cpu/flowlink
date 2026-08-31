from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path
from time import perf_counter

from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings
from app.schemas.inference import (
    ImageInferenceResponse,
    InferenceBBox,
    InferencePrediction,
    InferenceVideoTrack,
    VideoInferenceResponse,
)
from app.services.yolo_runtime import YoloRuntime, YoloRuntimeUnavailableError, get_yolo_runtime
from app.services.video_progress import VideoProgressReporter

IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_CONTENT_TYPES = {"video/mp4"}


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
                normalized_image = ImageOps.exif_transpose(image)
                try:
                    width, height = normalized_image.size
                    if width <= 0 or height <= 0:
                        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image dimensions")
                    if width * height > settings.IMAGE_MAX_PIXELS:
                        raise HTTPException(
                            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                            detail="Uploaded image dimensions are too large",
                        )
                    rgb_image = normalized_image.convert("RGB")
                finally:
                    if normalized_image is not image:
                        normalized_image.close()
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

    def analyze_video_file(
        self,
        video_path: Path,
        *,
        content_type: str,
        rendered_video_path: Path | None = None,
        video_job_id: int | None = None,
    ) -> VideoInferenceResponse:
        settings = get_settings()
        if content_type not in VIDEO_CONTENT_TYPES:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported media type")
        if not video_path.exists() or video_path.stat().st_size == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

        metadata = self._read_video_metadata(video_path)
        duration_seconds = metadata["frame_count"] / metadata["fps"]
        if duration_seconds > settings.VIDEO_MAX_DURATION_SECONDS:
            raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded video duration is too long")

        started_at = perf_counter()
        try:
            tracking_options = {
                "fps": metadata["fps"],
                "media_width": metadata["media_width"],
                "media_height": metadata["media_height"],
                "total_frames": metadata["frame_count"],
            }
            if video_job_id is not None:
                reporter = VideoProgressReporter(job_id=video_job_id)
                reporter.report("ANALYZING", 0, metadata["frame_count"], force=True)
                tracking_options["progress_callback"] = (
                    lambda stage, processed, total, force: reporter.report(
                        stage, processed, total, force=force
                    )
                )
            if rendered_video_path is not None:
                tracking_options["rendered_video_path"] = rendered_video_path
            tracks = self.runtime.track_video(video_path, **tracking_options)
        except YoloRuntimeUnavailableError as exc:
            raise InferenceModelUnavailableError("AI model is unavailable") from exc
        inference_ms = (perf_counter() - started_at) * 1000

        return VideoInferenceResponse(
            media_width=metadata["media_width"],
            media_height=metadata["media_height"],
            duration_ms=int(round(duration_seconds * 1000)),
            frame_count=metadata["frame_count"],
            fps=round(metadata["fps"], 3),
            inference_ms=round(inference_ms, 2),
            tracks=[
                InferenceVideoTrack(
                    label=track.model_label,
                    confidence=track.confidence,
                    bbox=InferenceBBox(
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
                for track in tracks
            ],
        )

    def _read_video_metadata(self, video_path: Path) -> dict[str, int | float]:
        try:
            import cv2
        except ImportError as exc:
            raise InferenceModelUnavailableError("Video decoder is unavailable") from exc

        capture = cv2.VideoCapture(str(video_path))
        try:
            if not capture.isOpened():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid video")
            frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = float(capture.get(cv2.CAP_PROP_FPS))
            media_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
            media_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if frame_count <= 0 or fps <= 0 or media_width <= 0 or media_height <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid video metadata")
            return {
                "frame_count": frame_count,
                "fps": fps,
                "media_width": media_width,
                "media_height": media_height,
            }
        finally:
            capture.release()


@lru_cache
def get_inference_service() -> ImageInferenceService:
    return ImageInferenceService(runtime=get_yolo_runtime())
