from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import DetectionEvent, VideoJob
from app.repositories.detections import USER_ANALYSIS_PURPOSE


ACTIVE_VIDEO_JOB_STAGES = {"QUEUED", "ANALYZING", "RENDERING", "SAVING"}


def get_upload_policy(settings: Settings) -> dict[str, object]:
    return {
        "image": {
            "allowed_content_types": ["image/jpeg", "image/png", "image/webp"],
            "source_max_bytes": settings.USER_IMAGE_SOURCE_MAX_BYTES,
            "source_max_pixels": settings.USER_IMAGE_SOURCE_MAX_PIXELS,
            "normalized_max_edge": settings.USER_IMAGE_NORMALIZED_MAX_EDGE,
            "normalized_target_bytes": settings.USER_IMAGE_NORMALIZED_TARGET_BYTES,
            "normalized_hard_max_bytes": settings.USER_IMAGE_NORMALIZED_HARD_MAX_BYTES,
        },
        "video": {
            "allowed_content_types": ["video/mp4"],
            "max_bytes": settings.USER_VIDEO_MAX_BYTES,
            "max_duration_seconds": settings.USER_VIDEO_MAX_DURATION_SECONDS,
            "max_source_edge": settings.USER_VIDEO_MAX_SOURCE_EDGE,
            "normalized_max_width": settings.USER_VIDEO_NORMALIZED_MAX_WIDTH,
            "normalized_max_height": settings.USER_VIDEO_NORMALIZED_MAX_HEIGHT,
            "normalized_max_fps": settings.USER_VIDEO_NORMALIZED_MAX_FPS,
        },
        "quota": {
            "image_count_last_24h": settings.USER_IMAGE_ROLLING_24H_LIMIT,
            "video_count_last_24h": settings.USER_VIDEO_ROLLING_24H_LIMIT,
            "media_storage_bytes": settings.USER_MEDIA_STORAGE_LIMIT_BYTES,
            "active_video_jobs": settings.USER_ACTIVE_VIDEO_JOB_LIMIT,
        },
    }


def _last_24h() -> datetime:
    return datetime.now(UTC) - timedelta(hours=24)


def count_recent_user_analyses(db: Session, *, user_id: int, source_type: str) -> int:
    statement = select(func.count(DetectionEvent.id)).where(
        DetectionEvent.user_id == user_id,
        DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
        DetectionEvent.source_type == source_type,
        DetectionEvent.status != "FAILED",
        DetectionEvent.created_at >= _last_24h(),
    )
    return int(db.scalar(statement) or 0)


def count_active_user_video_jobs(db: Session, *, user_id: int) -> int:
    statement = (
        select(func.count(VideoJob.id))
        .join(DetectionEvent, VideoJob.detection_event_id == DetectionEvent.id)
        .where(
            DetectionEvent.user_id == user_id,
            DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
            DetectionEvent.source_type == "VIDEO",
            DetectionEvent.status == "PROCESSING",
            VideoJob.status == "PROCESSING",
            VideoJob.processing_stage.in_(ACTIVE_VIDEO_JOB_STAGES),
        )
    )
    return int(db.scalar(statement) or 0)


def get_user_storage_usage(db: Session, *, user_id: int, settings: Settings) -> dict[str, object]:
    bytes_statement = select(
        func.coalesce(func.sum(func.coalesce(DetectionEvent.original_media_bytes, 0)), 0)
        + func.coalesce(func.sum(func.coalesce(DetectionEvent.result_media_bytes, 0)), 0)
    ).where(
        DetectionEvent.user_id == user_id,
        DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
        DetectionEvent.status != "FAILED",
    )
    used_bytes = int(db.scalar(bytes_statement) or 0)
    unknown_statement = select(func.count(DetectionEvent.id)).where(
        DetectionEvent.user_id == user_id,
        DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
        DetectionEvent.status != "FAILED",
        DetectionEvent.original_media_url.is_not(None),
        DetectionEvent.original_media_bytes.is_(None),
    )
    has_unknown_legacy_usage = bool(db.scalar(unknown_statement) or 0)
    limit_bytes = settings.USER_MEDIA_STORAGE_LIMIT_BYTES
    remaining_bytes = max(0, limit_bytes - used_bytes)
    usage_ratio = min(1.0, used_bytes / limit_bytes) if limit_bytes > 0 else 1.0
    return {
        "used_bytes": used_bytes,
        "limit_bytes": limit_bytes,
        "usage_ratio": usage_ratio,
        "remaining_bytes": remaining_bytes,
        "image_count_last_24h": count_recent_user_analyses(db, user_id=user_id, source_type="IMAGE"),
        "image_limit_last_24h": settings.USER_IMAGE_ROLLING_24H_LIMIT,
        "video_count_last_24h": count_recent_user_analyses(db, user_id=user_id, source_type="VIDEO"),
        "video_limit_last_24h": settings.USER_VIDEO_ROLLING_24H_LIMIT,
        "active_video_jobs": count_active_user_video_jobs(db, user_id=user_id),
        "active_video_job_limit": settings.USER_ACTIVE_VIDEO_JOB_LIMIT,
        "has_unknown_legacy_usage": has_unknown_legacy_usage,
    }


def ensure_user_analysis_quota(
    db: Session,
    *,
    user_id: int,
    source_type: str,
    incoming_bytes: int,
    settings: Settings,
) -> None:
    usage = get_user_storage_usage(db, user_id=user_id, settings=settings)
    if int(usage["used_bytes"]) + incoming_bytes > settings.USER_MEDIA_STORAGE_LIMIT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="사용자 탐지 저장 공간 한도를 초과했습니다. 기존 분석 기록을 정리한 뒤 다시 시도해 주세요.",
        )

    if source_type == "IMAGE":
        if int(usage["image_count_last_24h"]) >= settings.USER_IMAGE_ROLLING_24H_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="최근 24시간 이미지 분석 가능 횟수를 초과했습니다.",
            )
        return

    if source_type == "VIDEO":
        if int(usage["video_count_last_24h"]) >= settings.USER_VIDEO_ROLLING_24H_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="최근 24시간 영상 분석 가능 횟수를 초과했습니다.",
            )
        if int(usage["active_video_jobs"]) >= settings.USER_ACTIVE_VIDEO_JOB_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 처리 중인 영상 분석이 있습니다. 완료 후 다시 업로드해 주세요.",
            )
