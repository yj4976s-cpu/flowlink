from __future__ import annotations

import logging
import time
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import utc_now
from app.db.session import SessionLocal
from app.models import DetectionEvent, VideoJob
from app.repositories.detections import claim_next_queued_video_job, fail_detection_event
from app.services.detection_inference import DetectionInferenceService
from app.services.detections import process_detection_event

logger = logging.getLogger(__name__)


def resolve_job_media_path(event: DetectionEvent) -> Path:
    upload_root = Path(get_settings().UPLOAD_DIR).resolve()
    candidate = (upload_root / event.original_media_url.removeprefix("/uploads/")).resolve()
    if not candidate.is_relative_to(upload_root):
        raise RuntimeError("Invalid staged video path")
    if not candidate.is_file():
        raise RuntimeError("Staged video is unavailable")
    return candidate


def fail_stale_jobs(db: Session) -> int:
    threshold = utc_now() - timedelta(seconds=get_settings().VIDEO_JOB_STALE_SECONDS)
    jobs = db.scalars(
        select(VideoJob).where(
            VideoJob.status == "PROCESSING",
            VideoJob.processing_started_at < threshold,
        )
    ).all()
    for job in jobs:
        fail_detection_event(
            db,
            event=job.detection_event,
            message="Video processing exceeded the safe execution window",
            completed_at=utc_now(),
        )
    if jobs:
        db.commit()
    return len(jobs)


def process_one_job(db: Session, *, inference_service: DetectionInferenceService | None = None) -> bool:
    started_at = utc_now()
    job_id = claim_next_queued_video_job(db, started_at=started_at)
    db.commit()
    if job_id is None:
        return False

    job = db.get(VideoJob, job_id)
    if job is None:
        return False
    try:
        media_path = resolve_job_media_path(job.detection_event)
        process_detection_event(
            db,
            event_id=job.detection_event_id,
            media_path=media_path,
            inference_service=inference_service or DetectionInferenceService(),
            video_job_id=job.id,
        )
        logger.info("video job completed job_id=%s event_id=%s", job.id, job.detection_event_id)
    except Exception:
        db.rollback()
        event = db.get(DetectionEvent, job.detection_event_id)
        if event is not None and event.status != "FAILED":
            fail_detection_event(
                db,
                event=event,
                message="Video processing failed",
                completed_at=utc_now(),
            )
            db.commit()
        logger.error("video job failed job_id=%s event_id=%s category=processing", job.id, job.detection_event_id)
    return True


def run_worker() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    while True:
        with SessionLocal() as db:
            try:
                fail_stale_jobs(db)
                processed = process_one_job(db)
            except Exception:
                db.rollback()
                logger.error("video worker iteration failed category=worker-loop")
                processed = False
        if not processed:
            time.sleep(settings.VIDEO_JOB_POLL_SECONDS)


if __name__ == "__main__":
    run_worker()
