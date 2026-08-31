from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from app.models import DetectedObject, DetectionEvent, ObjectClass, VideoJob

USER_ANALYSIS_PURPOSE = "USER_ANALYSIS"
OPERATION_PURPOSE = "OPERATION"


def normalize_object_code(value: str) -> str:
    return value.strip().upper()


def add_detection_event(db: Session, event: DetectionEvent) -> DetectionEvent:
    db.add(event)
    db.flush()
    return event


def add_video_job(db: Session, job: VideoJob) -> VideoJob:
    db.add(job)
    db.flush()
    return job


def claim_next_queued_video_job(db: Session, *, started_at: datetime) -> int | None:
    statement = (
        select(VideoJob.id)
        .where(VideoJob.status == "PROCESSING", VideoJob.processing_stage == "QUEUED")
        .order_by(VideoJob.created_at, VideoJob.id)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    job_id = db.scalar(statement)
    if job_id is None:
        return None
    claimed = db.execute(
        update(VideoJob)
        .where(VideoJob.id == job_id, VideoJob.status == "PROCESSING", VideoJob.processing_stage == "QUEUED")
        .values(status="PROCESSING", processing_stage="ANALYZING", processing_started_at=started_at, updated_at=started_at)
    )
    return job_id if claimed.rowcount == 1 else None


def get_detection_event_by_id(db: Session, event_id: int) -> DetectionEvent | None:
    return db.get(DetectionEvent, event_id)


def get_user_detection_event(db: Session, *, event_id: int, user_id: int) -> DetectionEvent | None:
    statement = (
        select(DetectionEvent)
        .options(
            joinedload(DetectionEvent.detected_objects).joinedload(DetectedObject.object_class),
            joinedload(DetectionEvent.video_job),
        )
        .where(
            DetectionEvent.id == event_id,
            DetectionEvent.user_id == user_id,
            DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
        )
    )
    return db.scalars(statement).unique().one_or_none()


def list_user_detection_events_for_delete(db: Session, *, user_id: int) -> Sequence[DetectionEvent]:
    statement = (
        select(DetectionEvent)
        .options(
            joinedload(DetectionEvent.detected_objects),
            joinedload(DetectionEvent.video_job),
        )
        .where(
            DetectionEvent.user_id == user_id,
            DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
        )
    )
    return db.scalars(statement).unique().all()


def list_user_detection_events(
    db: Session,
    *,
    user_id: int,
    skip: int,
    limit: int,
) -> Sequence[DetectionEvent]:
    statement = (
        select(DetectionEvent)
        .options(joinedload(DetectionEvent.detected_objects).joinedload(DetectedObject.object_class))
        .where(
            DetectionEvent.user_id == user_id,
            DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
        )
        .order_by(DetectionEvent.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(statement).unique().all()


def delete_detection_event(db: Session, event: DetectionEvent) -> None:
    if event.video_job is not None:
        db.delete(event.video_job)
    for detected_object in list(event.detected_objects):
        db.delete(detected_object)
    db.delete(event)


def get_active_object_class_by_code(db: Session, code: str) -> ObjectClass | None:
    statement = select(ObjectClass).where(
        ObjectClass.code == normalize_object_code(code),
        ObjectClass.is_active.is_(True),
    )
    return db.scalar(statement)


def complete_detection_event(
    db: Session,
    *,
    event: DetectionEvent,
    objects: list[DetectedObject],
    media_width: int | None,
    media_height: int | None,
    completed_at: datetime,
) -> DetectionEvent:
    event.status = "COMPLETED"
    event.media_width = media_width
    event.media_height = media_height
    event.processing_completed_at = completed_at
    event.error_message = None
    db.add(event)
    if event.video_job is not None:
        event.video_job.status = "COMPLETED"
        event.video_job.processing_progress = 100
        event.video_job.processing_stage = "COMPLETED"
        event.video_job.failed_stage = None
        event.video_job.processing_completed_at = completed_at
        event.video_job.error_message = None
        db.add(event.video_job)
    for detected_object in objects:
        db.add(detected_object)
    db.flush()
    return event


def fail_detection_event(
    db: Session,
    *,
    event: DetectionEvent,
    message: str,
    completed_at: datetime,
) -> DetectionEvent:
    event.status = "FAILED"
    event.error_message = message
    event.processing_completed_at = completed_at
    db.add(event)
    if event.video_job is not None:
        failed_stage = event.video_job.processing_stage
        event.video_job.status = "FAILED"
        event.video_job.failed_stage = failed_stage if failed_stage in {"QUEUED", "ANALYZING", "RENDERING", "SAVING"} else None
        event.video_job.processing_stage = "FAILED"
        event.video_job.error_message = message
        event.video_job.processing_completed_at = completed_at
        db.add(event.video_job)
    db.flush()
    return event
