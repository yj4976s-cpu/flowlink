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
from app.services.user_media_uploads import normalize_user_video_in_place

logger = logging.getLogger(__name__)


def resolve_job_media_path(event: DetectionEvent) -> Path:
    upload_root = Path(get_settings().UPLOAD_DIR).resolve()
    candidate = (upload_root / event.original_media_url.removeprefix("/uploads/")).resolve()
    if not candidate.is_relative_to(upload_root):
        raise RuntimeError("Invalid staged video path")
    if not candidate.is_file():
        raise RuntimeError("Staged video is unavailable")
    return candidate


def _candidate_media_paths(event: DetectionEvent) -> list[Path]:
    paths: list[Path] = []
    try:
        original = resolve_job_media_path(event)
    except RuntimeError:
        original = None
    if original is not None:
        paths.append(original)
        paths.extend(
            candidate
            for candidate in original.parent.glob(f"{original.stem}*")
            if candidate.is_file() and candidate not in paths
        )
    upload_root = Path(get_settings().UPLOAD_DIR).resolve()
    for media_url in (event.result_media_url,):
        if not media_url:
            continue
        candidate = (upload_root / media_url.removeprefix("/uploads/")).resolve()
        if candidate.is_relative_to(upload_root) and candidate.is_file() and candidate not in paths:
            paths.append(candidate)
    return paths


def cleanup_video_event_files(event: DetectionEvent) -> None:
    for path in _candidate_media_paths(event):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("failed to cleanup video media path category=media-cleanup")


def clear_video_event_media_state(event: DetectionEvent) -> None:
    event.original_media_bytes = 0
    event.result_media_url = None
    event.result_media_bytes = 0


def mark_video_failed_and_cleanup(db: Session, *, event: DetectionEvent, message: str) -> None:
    cleanup_video_event_files(event)
    clear_video_event_media_state(event)
    fail_detection_event(db, event=event, message=message, completed_at=utc_now())


def fail_stale_jobs(db: Session) -> int:
    threshold = utc_now() - timedelta(seconds=get_settings().VIDEO_JOB_STALE_SECONDS)
    jobs = db.scalars(
        select(VideoJob).where(
            VideoJob.status == "PROCESSING",
            VideoJob.processing_started_at < threshold,
        )
    ).all()
    for job in jobs:
        mark_video_failed_and_cleanup(
            db,
            event=job.detection_event,
            message="Video processing exceeded the safe execution window",
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
        if job.detection_event.purpose == "USER_ANALYSIS":
            job.processing_stage = "NORMALIZING"
            job.updated_at = utc_now()
            db.commit()
            normalized_bytes = normalize_user_video_in_place(media_path, settings=get_settings())
            db.refresh(job)
            job.detection_event.original_media_bytes = normalized_bytes
            job.processing_stage = "ANALYZING"
            job.updated_at = utc_now()
            db.commit()
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
        if event is not None:
            cleanup_video_event_files(event)
            clear_video_event_media_state(event)
            if event.status != "FAILED":
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
