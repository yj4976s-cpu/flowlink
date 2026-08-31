from __future__ import annotations

import logging
from time import monotonic
from typing import Callable

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class VideoProgressReporter:
    def __init__(
        self,
        *,
        job_id: int,
        min_interval_seconds: float = 0.5,
        failure_backoff_seconds: float = 2.0,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self.job_id = job_id
        self.min_interval_seconds = min_interval_seconds
        self.failure_backoff_seconds = failure_backoff_seconds
        self.clock = clock
        self.last_attempt_at: float | None = None
        self.last_success_at: float | None = None
        self.next_retry_at = 0.0
        self.last_percent = -1

    def report(self, stage: str, processed_frames: int | None, total_frames: int | None, *, force: bool = False) -> None:
        now = self.clock()
        percent = None
        if processed_frames is not None and total_frames is not None and total_frames > 0:
            percent = min(100, max(0, round(processed_frames / total_frames * 100)))
        if now < self.next_retry_at:
            return
        if not force and stage == "ANALYZING":
            if percent is not None and percent <= self.last_percent:
                return
            if self.last_success_at is not None and now - self.last_success_at < self.min_interval_seconds:
                return
        payload: dict[str, int | str] = {"stage": stage}
        if processed_frames is not None:
            payload["processed_frames"] = processed_frames
        if total_frames is not None and total_frames > 0:
            payload["total_frames"] = total_frames
        settings = get_settings()
        self.last_attempt_at = now
        try:
            response = httpx.post(
                f"{settings.BACKEND_INTERNAL_URL.rstrip('/')}/api/internal/video-jobs/{self.job_id}/progress",
                headers={"X-Internal-API-Key": settings.AI_INTERNAL_API_KEY},
                json=payload,
                timeout=0.5,
            )
            response.raise_for_status()
        except (httpx.RequestError, httpx.HTTPStatusError):
            failure_completed_at = self.clock()
            self.next_retry_at = failure_completed_at + self.failure_backoff_seconds
            logger.warning("video progress callback failed job_id=%s stage=%s", self.job_id, stage)
            return
        self.last_success_at = now
        self.next_retry_at = 0.0
        if percent is not None:
            self.last_percent = max(self.last_percent, percent)
