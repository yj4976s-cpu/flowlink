"""Video diagnostics: identifiers and numeric codes only, never paths or exception text."""
from contextlib import contextmanager
from contextvars import ContextVar
import logging
from time import monotonic

logger = logging.getLogger(__name__)
video_job_context: ContextVar[tuple[int | None, int | None]] = ContextVar("video_job_context", default=(None, None))


def log_video_failure(phase: str, exc: Exception, *, elapsed_ms: int | None = None) -> None:
    job_id, event_id = video_job_context.get()
    cause = exc.__cause__
    logger.error(
        "video diagnostic job_id=%s event_id=%s phase=%s outcome=failed error_type=%s "
        "cause_type=%s errno=%s http_status=%s elapsed_ms=%s",
        job_id, event_id, phase, type(exc).__name__, type(cause).__name__ if cause else None,
        exc.errno if isinstance(exc, OSError) else None,
        getattr(exc, "status_code", None) if isinstance(getattr(exc, "status_code", None), int) else None,
        elapsed_ms,
    )


@contextmanager
def video_diagnostic_step(phase: str):
    job_id, event_id = video_job_context.get()
    started = monotonic()
    logger.info("video diagnostic job_id=%s event_id=%s phase=%s outcome=started", job_id, event_id, phase)
    try:
        yield
    except Exception as exc:
        log_video_failure(phase, exc, elapsed_ms=round((monotonic() - started) * 1000))
        raise
    else:
        logger.info(
            "video diagnostic job_id=%s event_id=%s phase=%s outcome=completed elapsed_ms=%s",
            job_id, event_id, phase, round((monotonic() - started) * 1000),
        )


def log_video_command_result(tool: str, returncode: int, stderr: str) -> None:
    # Classify known failures without copying FFmpeg stderr (which can contain paths/URLs).
    reason = "none" if returncode == 0 else "unclassified"
    if returncode != 0:
        lowered = stderr.lower()
        for marker, category in (
            ("permission denied", "permission_denied"),
            ("no space left on device", "disk_full"),
            ("cannot allocate memory", "memory_allocation"),
            ("resource temporarily unavailable", "resource_unavailable"),
            ("no such file or directory", "file_missing"),
            ("invalid data found", "invalid_media"),
        ):
            if marker in lowered:
                reason = category
                break
    job_id, event_id = video_job_context.get()
    logger.log(
        logging.INFO if returncode == 0 else logging.ERROR,
        "video diagnostic job_id=%s event_id=%s tool=%s returncode=%s reason=%s",
        job_id, event_id, tool, returncode, reason,
    )
