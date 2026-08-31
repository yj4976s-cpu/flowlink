from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.core.security import require_internal_api_key, utc_now
from app.db.session import get_db
from app.models import VideoJob
from app.schemas.detection import VideoProgressUpdate

router = APIRouter(prefix="/api/internal/video-jobs", tags=["internal-video-jobs"])


@router.post("/{job_id}/progress", status_code=status.HTTP_204_NO_CONTENT)
def update_video_job_progress(
    payload: VideoProgressUpdate,
    job_id: Annotated[int, Path(ge=1)],
    _: Annotated[None, Depends(require_internal_api_key)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    job = db.get(VideoJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video job not found")
    if job.status not in {"QUEUED", "PROCESSING"}:
        return
    if payload.total_frames is not None:
        job.total_frames = max(job.total_frames or 0, payload.total_frames)
    if payload.processed_frames is not None:
        job.processed_frames = max(job.processed_frames, payload.processed_frames)
    if payload.stage == "RENDERING":
        job.processing_stage = "RENDERING"
        if job.total_frames is not None:
            job.processed_frames = max(job.processed_frames, job.total_frames)
    elif job.processing_stage in {"QUEUED", "ANALYZING"}:
        job.processing_stage = "ANALYZING"
    job.status = "PROCESSING"
    job.updated_at = utc_now()
    db.commit()
