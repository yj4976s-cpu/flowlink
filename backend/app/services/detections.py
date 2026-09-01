from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models import Camera, DetectedObject, DetectionEvent, User, VideoJob
from app.repositories.detections import (
    OPERATION_PURPOSE,
    USER_ANALYSIS_PURPOSE,
    add_detection_event,
    add_video_job,
    complete_detection_event,
    fail_detection_event,
    get_active_object_class_by_code,
    get_detection_event_by_id,
)
from app.services.detection_inference import (
    DetectionInferenceResult,
    DetectionInferenceService,
    DetectionInferenceTimeoutError,
    DetectionInferenceUnavailableError,
)
from app.services.color_estimation import estimate_standard_color
from app.services.detection_notifications import (
    SAFE_VIDEO_TIMEOUT_MESSAGE,
    VIDEO_TIMEOUT_ERROR_CODE,
    ensure_detection_terminal_notification,
)
from app.services.user_media_policy import ensure_user_analysis_quota, get_user_storage_usage

SAFE_MODEL_UNAVAILABLE_MESSAGE = "AI detection model is not configured"
SAFE_VIDEO_FAILURE_MESSAGE = "영상 분석을 완료하지 못했어요. 잠시 후 다시 시도해주세요."


class DetectionProcessingError(RuntimeError):
    pass


class DetectionModelUnavailableError(DetectionProcessingError):
    pass


def utc_now() -> datetime:
    return datetime.now(UTC)


def sanitize_error_message(message: str) -> str:
    if message == SAFE_MODEL_UNAVAILABLE_MESSAGE:
        return message
    return "AI detection could not be completed"


def _add_user_detection_event(
    db: Session,
    *,
    current_user: User,
    source_type: str,
    media_key: str,
    original_media_bytes: int | None,
) -> DetectionEvent:
    now = utc_now()
    event = DetectionEvent(
        user_id=current_user.id,
        purpose=USER_ANALYSIS_PURPOSE,
        source_type=source_type,
        original_media_url=media_key,
        original_media_bytes=original_media_bytes,
        status="PROCESSING",
        captured_at=now,
        processing_started_at=now,
        created_at=now,
        updated_at=now,
    )
    add_detection_event(db, event)
    if source_type == "VIDEO":
        add_video_job(
            db,
            VideoJob(
                detection_event_id=event.id,
                status="PROCESSING",
                processing_progress=0,
                processing_stage="QUEUED",
                processed_frames=0,
                tracking_algorithm="BYTE_TRACK",
                created_at=now,
                updated_at=now,
            ),
        )
    return event


def create_user_detection_event(
    db: Session,
    *,
    current_user: User,
    source_type: str,
    media_key: str,
    original_media_bytes: int | None = None,
) -> DetectionEvent:
    event = _add_user_detection_event(
        db,
        current_user=current_user,
        source_type=source_type,
        media_key=media_key,
        original_media_bytes=original_media_bytes,
    )
    db.commit()
    db.refresh(event)
    return event


def create_user_detection_event_after_quota(
    db: Session,
    *,
    current_user: User,
    source_type: str,
    media_key: str,
    original_media_bytes: int,
    settings: Settings,
) -> DetectionEvent:
    db.execute(select(User.id).where(User.id == current_user.id).with_for_update())
    ensure_user_analysis_quota(
        db,
        user_id=current_user.id,
        source_type=source_type,
        incoming_bytes=original_media_bytes,
        settings=settings,
    )
    event = _add_user_detection_event(
        db,
        current_user=current_user,
        source_type=source_type,
        media_key=media_key,
        original_media_bytes=original_media_bytes,
    )
    db.commit()
    db.refresh(event)
    return event


def create_operation_detection_event(
    db: Session,
    *,
    current_admin: User,
    camera: Camera,
    source_type: str,
    media_key: str,
    original_media_bytes: int | None = None,
) -> DetectionEvent:
    now = utc_now()
    event = DetectionEvent(
        user_id=current_admin.id, camera_id=camera.id, purpose=OPERATION_PURPOSE,
        source_type=source_type, original_media_url=media_key, original_media_bytes=original_media_bytes, status="PROCESSING",
        captured_at=now, processing_started_at=now, created_at=now, updated_at=now,
    )
    add_detection_event(db, event)
    db.commit()
    db.refresh(event)
    return event


def process_detection_event(
    db: Session,
    *,
    event_id: int,
    media_path: Path,
    inference_service: DetectionInferenceService,
    video_job_id: int | None = None,
) -> DetectionEvent:
    event = get_detection_event_by_id(db, event_id)
    if event is None:
        raise DetectionProcessingError("Detection event not found")

    try:
        result = (
            inference_service.analyze_video(media_path, video_job_id=video_job_id)
            if event.source_type == "VIDEO"
            else inference_service.analyze_image(media_path)
        )
        if event.source_type == "VIDEO" and event.video_job is not None:
            db.refresh(event.video_job)
            event.video_job.processing_stage = "SAVING"
            event.video_job.updated_at = utc_now()
            db.commit()
        return _complete_with_result(db, event=event, result=result, media_path=media_path)
    except DetectionInferenceTimeoutError as exc:
        _mark_failed(db, event=event, message=VIDEO_TIMEOUT_ERROR_CODE)
        raise DetectionProcessingError(SAFE_VIDEO_TIMEOUT_MESSAGE) from exc
    except DetectionInferenceUnavailableError as exc:
        failed_event = _mark_failed(db, event=event, message=sanitize_error_message(str(exc)))
        raise DetectionModelUnavailableError(SAFE_MODEL_UNAVAILABLE_MESSAGE) from exc
    except Exception as exc:
        _mark_failed(db, event=event, message=sanitize_error_message(str(exc)))
        raise


def _complete_with_result(
    db: Session,
    *,
    event: DetectionEvent,
    result: DetectionInferenceResult,
    media_path: Path,
) -> DetectionEvent:
    now = utc_now()
    objects: list[DetectedObject] = []
    rendered_media_path: Path | None = None

    try:
        if event.source_type == "VIDEO" and not result.rendered_video:
            raise DetectionProcessingError("Rendered detection video is required")
        if event.source_type == "VIDEO" and result.rendered_video:
            rendered_media_path = media_path.with_name(f"{media_path.stem}-result.mp4")
            rendered_media_path.write_bytes(result.rendered_video)
            event.result_media_url = rendered_media_path.relative_to(media_path.parents[3]).as_posix()
            event.result_media_bytes = rendered_media_path.stat().st_size
        if event.original_media_bytes is None and media_path.exists():
            event.original_media_bytes = media_path.stat().st_size
        if event.purpose == USER_ANALYSIS_PURPOSE and event.user_id is not None:
            db.flush()
            usage = get_user_storage_usage(db, user_id=event.user_id, settings=get_settings())
            if int(usage["used_bytes"]) > int(usage["limit_bytes"]):
                raise DetectionProcessingError("User media storage limit exceeded")
        event.ai_model_id = result.model_id
        for prediction in result.detections:
            class_code = prediction.class_code.strip().upper()
            object_class = get_active_object_class_by_code(db, class_code)
            if object_class is None or object_class.group_code == "UNKNOWN":
                raise DetectionProcessingError("Detection class mapping failed")
            objects.append(
                DetectedObject(
                    detection_event_id=event.id,
                    object_class_id=object_class.id,
                    processing_status="PENDING",
                    track_id=prediction.track_id,
                    confidence=Decimal(str(prediction.confidence)),
                    bbox_x=Decimal(str(prediction.bbox.x)),
                    bbox_y=Decimal(str(prediction.bbox.y)),
                    bbox_width=Decimal(str(prediction.bbox.width)),
                    bbox_height=Decimal(str(prediction.bbox.height)),
                    ai_color=estimate_standard_color(
                        media_path,
                        bbox_x=prediction.bbox.x,
                        bbox_y=prediction.bbox.y,
                        bbox_width=prediction.bbox.width,
                        bbox_height=prediction.bbox.height,
                    ) if event.purpose == OPERATION_PURPOSE and event.source_type == "IMAGE" else None,
                    first_seen_ms=prediction.first_seen_ms,
                    last_seen_ms=prediction.last_seen_ms,
                    appearance_count=prediction.appearance_count,
                    detected_at=now,
                    created_at=now,
                )
            )
        complete_detection_event(
            db,
            event=event,
            objects=objects,
            media_width=result.media_width,
            media_height=result.media_height,
            completed_at=now,
        )
        ensure_detection_terminal_notification(db, event=event)
        db.commit()
    except Exception:
        db.rollback()
        if rendered_media_path is not None:
            rendered_media_path.unlink(missing_ok=True)
        event.original_media_bytes = 0
        event.result_media_url = None
        event.result_media_bytes = 0
        _mark_failed(db, event=event, message="AI detection results could not be saved")
        raise

    db.refresh(event)
    return event


def _mark_failed(db: Session, *, event: DetectionEvent, message: str) -> DetectionEvent:
    now = utc_now()
    fail_detection_event(db, event=event, message=message, completed_at=now)
    ensure_detection_terminal_notification(db, event=event)
    db.commit()
    db.refresh(event)
    return event
