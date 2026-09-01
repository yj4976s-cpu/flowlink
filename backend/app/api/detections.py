from __future__ import annotations

import logging
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Path as ApiPath, Query, UploadFile, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.auth import get_current_user, require_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models import User
from app.repositories.detections import (
    delete_detection_event,
    get_user_detection_event,
    list_user_detection_events,
    list_user_detection_events_for_delete,
)
from app.schemas.common import MessageResponse
from app.schemas.detection import (
    DetectionBBoxResponse,
    DetectionEventResponse,
    DetectionAnalysisSummaryResponse,
    DetectionStorageUsageResponse,
    DetectionUploadPolicyResponse,
    VideoDetectionAcceptedResponse,
    VideoProcessingStatusResponse,
    WebcamDetectionFrameResponse,
    WebcamDetectionObjectResponse,
)
from app.services.detection_inference import DetectionInferenceService, get_inference_service
from app.services.detections import (
    DetectionModelUnavailableError,
    SAFE_VIDEO_FAILURE_MESSAGE,
    SAFE_VIDEO_TIMEOUT_MESSAGE,
    create_user_detection_event_after_quota,
    process_detection_event,
)
from app.services.detection_notifications import is_video_timeout_error
from app.services.user_media_policy import ensure_user_analysis_quota, get_upload_policy, get_user_storage_usage
from app.services.user_media_uploads import save_normalized_user_image, save_user_video_upload, validate_saved_user_video
from app.services.user_analysis_reports import ALLOWED_SUMMARY_DAYS, build_user_analysis_summary
from app.services.webcam_inference import (
    WebcamDetectionFrame,
    WebcamInferenceService,
    WebcamInferenceUnavailableError,
    get_webcam_inference_service,
)
from app.services.mappers import detection_event_response

router = APIRouter(prefix="/api/detections", tags=["detections"])
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
WEBCAM_FRAME_MAX_BYTES = 2 * 1024 * 1024
WEBCAM_FRAME_MAX_PIXELS = 4_000_000


def resolve_upload_root() -> Path:
    configured = Path(get_settings().UPLOAD_DIR)
    root = configured if configured.is_absolute() else BACKEND_DIR / configured
    return root.resolve()


def detection_media_paths(event) -> list[str]:
    return [path for path in (event.original_media_url, event.result_media_url) if path]


def remove_detection_media(media_url: str, upload_root: Path) -> None:
    relative_url = media_url.removeprefix("/uploads/") if media_url.startswith("/uploads/") else media_url
    target = (upload_root / relative_url).resolve()
    if not target.is_relative_to(upload_root):
        logger.warning("Skipped detection media cleanup outside upload root: %s", media_url)
        return
    try:
        target.unlink(missing_ok=True)
    except OSError:
        logger.warning("Failed to remove detection media: %s", target, exc_info=True)


def get_latest_user_event_or_404(db: Session, *, event_id: int, user_id: int) -> DetectionEventResponse:
    event = get_user_detection_event(db, event_id=event_id, user_id=user_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection event not found")
    return detection_event_response(event)


@router.get("/upload-policy", response_model=DetectionUploadPolicyResponse)
def get_detection_upload_policy() -> DetectionUploadPolicyResponse:
    return DetectionUploadPolicyResponse(**get_upload_policy(get_settings()))


@router.get("/me/storage-usage", response_model=DetectionStorageUsageResponse)
def get_my_detection_storage_usage(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> DetectionStorageUsageResponse:
    return DetectionStorageUsageResponse(**get_user_storage_usage(db, user_id=current_user.id, settings=get_settings()))


@router.get("/me/summary", response_model=DetectionAnalysisSummaryResponse, summary="내 AI 분석 요약 보고서")
def get_my_detection_summary(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query()] = 30,
) -> DetectionAnalysisSummaryResponse:
    if days not in ALLOWED_SUMMARY_DAYS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported summary period")
    return build_user_analysis_summary(db, user_id=current_user.id, days=days)


async def read_webcam_frame(file: UploadFile) -> Image.Image:
    if file.content_type != "image/jpeg":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported media type")

    payload = await file.read(WEBCAM_FRAME_MAX_BYTES + 1)
    if len(payload) > WEBCAM_FRAME_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded file is too large")
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    try:
        with Image.open(BytesIO(payload)) as image:
            image.load()
            width, height = image.size
            if width <= 0 or height <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image dimensions")
            if width * height > WEBCAM_FRAME_MAX_PIXELS:
                raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded image dimensions are too large")
            return image.convert("RGB")
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JPEG frame") from exc


def webcam_frame_response(frame: WebcamDetectionFrame) -> WebcamDetectionFrameResponse:
    return WebcamDetectionFrameResponse(
        media_width=frame.media_width,
        media_height=frame.media_height,
        inference_ms=frame.inference_ms,
        detected_objects=[
            WebcamDetectionObjectResponse(
                label=detected.label,
                class_code=detected.class_code,
                class_name_ko=detected.class_name_ko,
                group_code=detected.group_code,
                confidence=detected.confidence,
                bbox=DetectionBBoxResponse(
                    x=detected.bbox.x,
                    y=detected.bbox.y,
                    width=detected.bbox.width,
                    height=detected.bbox.height,
                ),
            )
            for detected in frame.detected_objects
        ],
    )


@router.post("/images", response_model=DetectionEventResponse, status_code=201, summary="이미지 AI 탐지")
async def detect_image(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    inference_service: Annotated[DetectionInferenceService, Depends(get_inference_service)],
    file: Annotated[UploadFile, File(description="탐지할 이미지")],
) -> DetectionEventResponse:
    settings = get_settings()
    upload_root = resolve_upload_root()
    ensure_user_analysis_quota(db, user_id=current_user.id, source_type="IMAGE", incoming_bytes=0, settings=settings)
    media_path, media_key, media_bytes = await save_normalized_user_image(
        file,
        current_user=current_user,
        upload_root=upload_root,
        settings=settings,
    )
    try:
        event = create_user_detection_event_after_quota(
            db,
            current_user=current_user,
            source_type="IMAGE",
            media_key=media_key,
            original_media_bytes=media_bytes,
            settings=settings,
        )
    except Exception:
        media_path.unlink(missing_ok=True)
        raise
    try:
        process_detection_event(db, event_id=event.id, media_path=media_path, inference_service=inference_service)
    except DetectionModelUnavailableError as exc:
        media_path.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        media_path.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AI detection could not be completed") from exc
    return get_latest_user_event_or_404(db, event_id=event.id, user_id=current_user.id)


@router.post("/videos", response_model=VideoDetectionAcceptedResponse, status_code=202, summary="영상 AI 탐지")
async def detect_video(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File(description="탐지할 영상")],
) -> VideoDetectionAcceptedResponse:
    settings = get_settings()
    # Cheap preflight only; the final quota check is locked together with event creation below.
    ensure_user_analysis_quota(db, user_id=current_user.id, source_type="VIDEO", incoming_bytes=0, settings=settings)
    upload_root = resolve_upload_root()
    media_path, media_key, media_bytes = await save_user_video_upload(
        file,
        current_user=current_user,
        upload_root=upload_root,
        settings=settings,
    )
    try:
        video_probe = await run_in_threadpool(validate_saved_user_video, media_path, settings=settings) or {}
    except Exception:
        media_path.unlink(missing_ok=True)
        raise
    try:
        event = create_user_detection_event_after_quota(
            db,
            current_user=current_user,
            source_type="VIDEO",
            media_key=media_key,
            original_media_bytes=media_bytes,
            settings=settings,
        )
    except Exception:
        media_path.unlink(missing_ok=True)
        raise
    duration = video_probe.get("duration")
    if event.video_job is not None and isinstance(duration, (int, float)) and duration > 0:
        event.video_job.video_duration_seconds = Decimal(str(round(duration, 2)))
        db.add(event.video_job)
        db.commit()
        db.refresh(event)
    return VideoDetectionAcceptedResponse(
        detection_event_id=event.id,
        video_job_id=event.video_job.id,
        status=event.video_job.status,
        stage=event.video_job.processing_stage,
    )


@router.get("/{id}/processing-status", response_model=VideoProcessingStatusResponse)
def get_video_processing_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, ApiPath(ge=1)],
) -> VideoProcessingStatusResponse:
    event = get_user_detection_event(db, event_id=id, user_id=current_user.id)
    if event is None or event.source_type != "VIDEO" or event.video_job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video job not found")
    job = event.video_job
    analysis_progress = None
    if job.total_frames is not None and job.total_frames > 0:
        analysis_progress = min(100, max(0, round(job.processed_frames / job.total_frames * 100)))
    return VideoProcessingStatusResponse(
        detection_event_id=event.id,
        video_job_id=job.id,
        status=job.status,
        stage=job.processing_stage,
        failed_stage=job.failed_stage,
        processed_frames=job.processed_frames,
        total_frames=job.total_frames,
        analysis_progress=analysis_progress,
        processing_started_at=job.processing_started_at,
        processing_completed_at=job.processing_completed_at,
        result_ready=job.status == "COMPLETED",
        error_message=(
            SAFE_VIDEO_TIMEOUT_MESSAGE
            if job.status == "FAILED" and is_video_timeout_error(job.error_message)
            else SAFE_VIDEO_FAILURE_MESSAGE if job.status == "FAILED" else None
        ),
    )


@router.post("/webcam/frame", response_model=WebcamDetectionFrameResponse, summary="실시간 웹캠 프레임 AI 탐지")
async def detect_webcam_frame(
    current_user: Annotated[User, Depends(get_current_user)],
    inference_service: Annotated[WebcamInferenceService, Depends(get_webcam_inference_service)],
    file: Annotated[UploadFile, File(description="탐지할 웹캠 JPEG 프레임")],
) -> WebcamDetectionFrameResponse:
    del current_user
    image = await read_webcam_frame(file)
    try:
        result = await run_in_threadpool(inference_service.analyze_frame, image)
    except WebcamInferenceUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Webcam detection model is unavailable") from exc
    return webcam_frame_response(result)


@router.get("/me", response_model=list[DetectionEventResponse], summary="내 AI 탐지 기록 조회")
def list_my_detections(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[DetectionEventResponse]:
    events = list_user_detection_events(db, user_id=current_user.id, skip=skip, limit=limit)
    return [detection_event_response(event) for event in events]


@router.delete("/me", response_model=MessageResponse, summary="내 AI 탐지 기록 전체 삭제")
def delete_my_detections(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MessageResponse:
    events = list_user_detection_events_for_delete(db, user_id=current_user.id)
    media_urls = [media_url for event in events for media_url in detection_media_paths(event)]
    try:
        for event in events:
            delete_detection_event(db, event)
        db.commit()
    except Exception:
        db.rollback()
        raise

    upload_root = resolve_upload_root()
    for media_url in media_urls:
        remove_detection_media(media_url, upload_root)
    return MessageResponse(message="Detection history deleted")


@router.delete("/{id}", response_model=MessageResponse, summary="내 AI 탐지 기록 삭제")
def delete_detection(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, ApiPath(ge=1)],
) -> MessageResponse:
    event = get_user_detection_event(db, event_id=id, user_id=current_user.id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection event not found")

    media_urls = detection_media_paths(event)
    try:
        delete_detection_event(db, event)
        db.commit()
    except Exception:
        db.rollback()
        raise

    upload_root = resolve_upload_root()
    for media_url in media_urls:
        remove_detection_media(media_url, upload_root)
    return MessageResponse(message="Detection history deleted")


@router.get("/{id}", response_model=DetectionEventResponse, summary="내 AI 탐지 상세 조회")
def get_detection(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, ApiPath(ge=1)],
) -> DetectionEventResponse:
    return get_latest_user_event_or_404(db, event_id=id, user_id=current_user.id)
