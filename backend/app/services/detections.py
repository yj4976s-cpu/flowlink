from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy.orm import Session

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
    DetectionInferenceUnavailableError,
)
from app.services.color_estimation import estimate_standard_color

SAFE_MODEL_UNAVAILABLE_MESSAGE = "AI detection model is not configured"


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


def create_user_detection_event(
    db: Session,
    *,
    current_user: User,
    source_type: str,
    media_key: str,
) -> DetectionEvent:
    now = utc_now()
    event = DetectionEvent(
        user_id=current_user.id,
        purpose=USER_ANALYSIS_PURPOSE,
        source_type=source_type,
        original_media_url=media_key,
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
                tracking_algorithm="BYTE_TRACK",
                processing_started_at=now,
                created_at=now,
                updated_at=now,
            ),
        )
    db.commit()
    db.refresh(event)
    return event


def create_operation_detection_event(
    db: Session, *, current_admin: User, camera: Camera, source_type: str, media_key: str
) -> DetectionEvent:
    now = utc_now()
    event = DetectionEvent(
        user_id=current_admin.id, camera_id=camera.id, purpose=OPERATION_PURPOSE,
        source_type=source_type, original_media_url=media_key, status="PROCESSING",
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
) -> DetectionEvent:
    event = get_detection_event_by_id(db, event_id)
    if event is None:
        raise DetectionProcessingError("Detection event not found")

    try:
        result = (
            inference_service.analyze_video(media_path)
            if event.source_type == "VIDEO"
            else inference_service.analyze_image(media_path)
        )
        return _complete_with_result(db, event=event, result=result, media_path=media_path)
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
        db.commit()
    except Exception:
        db.rollback()
        if rendered_media_path is not None:
            rendered_media_path.unlink(missing_ok=True)
        _mark_failed(db, event=event, message="AI detection results could not be saved")
        raise

    db.refresh(event)
    return event


def _mark_failed(db: Session, *, event: DetectionEvent, message: str) -> DetectionEvent:
    now = utc_now()
    fail_detection_event(db, event=event, message=message, completed_at=now)
    db.commit()
    db.refresh(event)
    return event
