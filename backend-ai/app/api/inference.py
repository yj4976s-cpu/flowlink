from typing import Annotated
from io import BytesIO
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile, status
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.security import require_internal_api_key
from app.schemas.inference import ImageInferenceResponse, VideoInferenceResponse, WebcamTrackingResponse
from app.services.inference import ImageInferenceService, InferenceModelUnavailableError, get_inference_service

router = APIRouter(prefix="/api/inference", tags=["inference"])
VIDEO_CONTENT_TYPES = {"video/mp4"}
UPLOAD_CHUNK_BYTES = 1024 * 1024


@router.post("/images", response_model=ImageInferenceResponse, summary="이미지 YOLO 추론")
async def infer_image(
    _: Annotated[None, Depends(require_internal_api_key)],
    service: Annotated[ImageInferenceService, Depends(get_inference_service)],
    file: Annotated[UploadFile, File(description="추론할 이미지")],
) -> ImageInferenceResponse:
    payload = await file.read(get_settings().IMAGE_MAX_BYTES + 1)
    try:
        return await run_in_threadpool(
            service.analyze_image_bytes,
            payload,
            content_type=file.content_type or "",
        )
    except InferenceModelUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI model is unavailable") from exc


@router.post("/webcam/frames", response_model=WebcamTrackingResponse, summary="웹캠 세션 ByteTrack 추론")
async def track_webcam_frame(
    _: Annotated[None, Depends(require_internal_api_key)],
    service: Annotated[ImageInferenceService, Depends(get_inference_service)],
    session_id: Annotated[str, Form(min_length=1, max_length=160)],
    file: Annotated[UploadFile, File(description="웹캠 JPEG 프레임")],
) -> WebcamTrackingResponse:
    if (file.content_type or "").lower() not in {"image/jpeg", "image/jpg"}:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported media type")
    payload = await file.read(get_settings().IMAGE_MAX_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    if len(payload) > get_settings().IMAGE_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded file is too large")
    try:
        with Image.open(BytesIO(payload)) as source:
            source.load()
            if source.width * source.height > get_settings().IMAGE_MAX_PIXELS:
                raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded image has too many pixels")
            image = source.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image") from exc
    try:
        return await run_in_threadpool(service.track_webcam_image, image, session_id=session_id)
    except InferenceModelUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI model is unavailable") from exc


@router.post("/videos", response_model=VideoInferenceResponse, summary="영상 YOLO ByteTrack 추론")
async def infer_video(
    _: Annotated[None, Depends(require_internal_api_key)],
    service: Annotated[ImageInferenceService, Depends(get_inference_service)],
    file: Annotated[UploadFile, File(description="추론할 MP4 영상")],
    render: Annotated[bool, Query()] = False,
    video_job_id: Annotated[int | None, Header(alias="X-Video-Job-ID", ge=1)] = None,
) -> VideoInferenceResponse | Response:
    content_type = file.content_type or ""
    if content_type not in VIDEO_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported media type")

    video_path = await _save_temp_video(file)
    rendered_path = video_path.with_name(f"{video_path.stem}-detected.mp4") if render else None
    try:
        analyze_options = {"content_type": content_type}
        if rendered_path is not None:
            analyze_options["rendered_video_path"] = rendered_path
        if video_job_id is not None:
            analyze_options["video_job_id"] = video_job_id
        result = await run_in_threadpool(service.analyze_video_file, video_path, **analyze_options)
        if not render:
            return result
        if rendered_path is None or not rendered_path.exists() or rendered_path.stat().st_size == 0:
            raise InferenceModelUnavailableError("Rendered video was not created")
        archive = BytesIO()
        with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
            bundle.writestr("result.json", json.dumps(result.model_dump(mode="json")))
            bundle.write(rendered_path, "result.mp4")
        return Response(content=archive.getvalue(), media_type="application/zip")
    except InferenceModelUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI model is unavailable") from exc
    finally:
        video_path.unlink(missing_ok=True)
        if rendered_path is not None:
            rendered_path.unlink(missing_ok=True)


async def _save_temp_video(file: UploadFile) -> Path:
    settings = get_settings()
    video_path: Path | None = None
    total_bytes = 0
    try:
        with NamedTemporaryFile(prefix="flowlink-video-", suffix=".mp4", delete=False) as temp_file:
            video_path = Path(temp_file.name)
            while chunk := await file.read(UPLOAD_CHUNK_BYTES):
                total_bytes += len(chunk)
                if total_bytes > settings.VIDEO_MAX_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded file is too large")
                temp_file.write(chunk)
    except Exception:
        if video_path is not None:
            video_path.unlink(missing_ok=True)
        raise

    if video_path is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    if total_bytes == 0:
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    return video_path
