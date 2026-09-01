from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import DetectionEvent, Notification
from app.repositories.detections import USER_ANALYSIS_PURPOSE

TERMINAL_NOTIFICATION_TYPES = {
    "COMPLETED": "DETECTION_COMPLETED",
    "FAILED": "DETECTION_FAILED",
}
SAFE_VIDEO_TIMEOUT_MESSAGE = "영상 분석 시간이 예상보다 길어 중단되었습니다. 잠시 후 다시 시도해주세요."
VIDEO_TIMEOUT_ERROR_CODE = "VIDEO_PROCESSING_TIMEOUT"
LEGACY_VIDEO_TIMEOUT_MESSAGES = {
    SAFE_VIDEO_TIMEOUT_MESSAGE,
    "영상 분석 시간이 예상보다 길어 중단되었어요. 잠시 후 다시 시도해주세요.",
    "Video processing timed out",
    "Video processing exceeded the safe execution window",
}


def utc_now() -> datetime:
    return datetime.now(UTC)


def _completed_message(event: DetectionEvent) -> str:
    objects = list(event.detected_objects)
    if not objects:
        return "영상 분석이 완료되었지만 탐지·추적된 객체는 없습니다."
    classes = {detected.object_class.name_ko for detected in objects if detected.object_class is not None}
    return f"영상에서 주요 클래스 {len(classes)}종, 총 {len(objects)}개의 객체를 탐지·추적했습니다."


def _failed_message() -> str:
    return "영상 분석을 완료하지 못했습니다. 다시 시도하거나 업로드 조건을 확인해주세요."


def is_video_timeout_error(message: str | None) -> bool:
    return message == VIDEO_TIMEOUT_ERROR_CODE or message in LEGACY_VIDEO_TIMEOUT_MESSAGES


def ensure_detection_terminal_notification(db: Session, *, event: DetectionEvent) -> Notification | None:
    if (
        event.purpose != USER_ANALYSIS_PURPOSE
        or event.source_type != "VIDEO"
        or event.user_id is None
        or event.status not in TERMINAL_NOTIFICATION_TYPES
    ):
        return None

    notification_type = TERMINAL_NOTIFICATION_TYPES[event.status]
    existing_statement = select(Notification.id).where(
        Notification.user_id == event.user_id,
        Notification.notification_type == notification_type,
        Notification.related_type == "DETECTION_EVENT",
        Notification.related_id == event.id,
    )
    if db.scalar(existing_statement) is not None:
        return None

    if event.status == "COMPLETED":
        title = "영상 AI 분석이 완료되었습니다"
        message = _completed_message(event)
    else:
        title = "영상 AI 분석을 완료하지 못했습니다"
        message = _failed_message()
        if is_video_timeout_error(event.error_message):
            message = "영상 분석 시간이 예상보다 길어 중단되었습니다. 다시 시도해주세요."

    notification = Notification(
        user_id=event.user_id,
        notification_type=notification_type,
        title=title,
        message=message,
        related_type="DETECTION_EVENT",
        related_id=event.id,
        created_at=utc_now(),
    )
    try:
        with db.begin_nested():
            db.add(notification)
            db.flush()
    except IntegrityError:
        return None
    return notification
