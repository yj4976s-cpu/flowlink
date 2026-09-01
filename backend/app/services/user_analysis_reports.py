from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import DetectedObject, DetectionEvent, ObjectClass
from app.repositories.detections import USER_ANALYSIS_PURPOSE
from app.schemas.detection import (
    DetectionAnalysisSummaryResponse,
    DetectionClassDistributionItem,
    DetectionConfidenceDistributionItem,
    DetectionDailyTrendItem,
    DetectionRecentEventSummary,
)

ALLOWED_SUMMARY_DAYS = (7, 30, 90)
CLASS_ORDER = ("BALL", "FOOTWEAR", "TRASH", "HAT")
KST = ZoneInfo("Asia/Seoul")

CONFIDENCE_BUCKETS = (
    ("GE_90", "90% 이상"),
    ("GE_70", "70% 이상 90% 미만"),
    ("GE_50", "50% 이상 70% 미만"),
    ("LT_50", "50% 미만"),
)


def utc_now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _round_ratio(count: int, total: int) -> float:
    return round(count / total, 4) if total else 0.0


def _round_percent(count: int, total: int) -> float:
    return round(count / total * 100, 1) if total else 0.0


def _confidence_bucket(confidence: Decimal) -> str:
    if confidence >= Decimal("0.9"):
        return "GE_90"
    if confidence >= Decimal("0.7"):
        return "GE_70"
    if confidence >= Decimal("0.5"):
        return "GE_50"
    return "LT_50"


def _event_date_kst(event: DetectionEvent) -> str:
    return _as_utc(event.created_at).astimezone(KST).date().isoformat()


def analysis_period_window(days: int, *, now: datetime | None = None) -> tuple[datetime, datetime, list[str]]:
    if days not in ALLOWED_SUMMARY_DAYS:
        raise ValueError("Unsupported summary period")
    generated_at = _as_utc(now or utc_now())
    kst_today = generated_at.astimezone(KST).date()
    first_kst_day = kst_today - timedelta(days=days - 1)
    period_start = datetime.combine(first_kst_day, time.min, tzinfo=KST).astimezone(UTC)
    trend_dates = [(first_kst_day + timedelta(days=offset)).isoformat() for offset in range(days)]
    return period_start, generated_at, trend_dates


def _ordered_class_map(db: Session) -> dict[str, str]:
    rows = db.execute(select(ObjectClass.code, ObjectClass.name_ko).where(ObjectClass.code.in_(CLASS_ORDER))).all()
    names = {code: name for code, name in rows}
    return {code: names.get(code, code) for code in CLASS_ORDER}


def list_user_analysis_events_for_summary(
    db: Session,
    *,
    user_id: int,
    period_start: datetime,
    period_end: datetime,
) -> list[DetectionEvent]:
    statement = (
        select(DetectionEvent)
        .options(joinedload(DetectionEvent.detected_objects).joinedload(DetectedObject.object_class))
        .where(
            DetectionEvent.user_id == user_id,
            DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
            DetectionEvent.source_type.in_(("IMAGE", "VIDEO")),
            DetectionEvent.created_at >= period_start,
            DetectionEvent.created_at <= period_end,
        )
        .order_by(DetectionEvent.created_at.desc(), DetectionEvent.id.desc())
    )
    return list(db.scalars(statement).unique().all())


def build_user_analysis_summary(
    db: Session,
    *,
    user_id: int,
    days: int,
    now: datetime | None = None,
) -> DetectionAnalysisSummaryResponse:
    if days not in ALLOWED_SUMMARY_DAYS:
        raise ValueError("Unsupported summary period")

    period_start, period_end, trend_dates = analysis_period_window(days, now=now)
    events = list_user_analysis_events_for_summary(
        db,
        user_id=user_id,
        period_start=period_start,
        period_end=period_end,
    )

    total = len(events)
    completed_events = [event for event in events if event.status == "COMPLETED"]
    failed_count = sum(1 for event in events if event.status == "FAILED")
    in_progress_count = sum(1 for event in events if event.status in {"PENDING", "PROCESSING"})
    image_count = sum(1 for event in events if event.source_type == "IMAGE")
    video_count = sum(1 for event in events if event.source_type == "VIDEO")

    detected_objects = [
        detected_object
        for event in completed_events
        for detected_object in event.detected_objects
    ]
    object_total = len(detected_objects)
    class_counts = Counter(detected_object.object_class.code for detected_object in detected_objects)
    class_names = _ordered_class_map(db)
    confidence_counts = Counter(_confidence_bucket(detected_object.confidence) for detected_object in detected_objects)
    confidence_sum = sum((detected_object.confidence for detected_object in detected_objects), Decimal("0"))

    trend: dict[str, dict[str, int]] = {
        date: {"analysis_count": 0, "object_count": 0}
        for date in trend_dates
    }
    for event in events:
        date_key = _event_date_kst(event)
        if date_key not in trend:
            continue
        trend[date_key]["analysis_count"] += 1
        if event.status == "COMPLETED":
            trend[date_key]["object_count"] += len(event.detected_objects)

    recent_events: list[DetectionRecentEventSummary] = []
    for event in events[:10]:
        event_objects = list(event.detected_objects) if event.status == "COMPLETED" else []
        primary = max(event_objects, key=lambda item: item.confidence, default=None)
        average = (
            round(float(sum((item.confidence for item in event_objects), Decimal("0")) / len(event_objects)), 4)
            if event_objects else None
        )
        recent_events.append(
            DetectionRecentEventSummary(
                id=event.id,
                source_type=event.source_type,
                status=event.status,
                created_at=event.created_at,
                processing_completed_at=event.processing_completed_at,
                object_count=len(event_objects),
                primary_class_code=primary.object_class.code if primary else None,
                primary_class_name_ko=primary.object_class.name_ko if primary else None,
                average_confidence=average,
            )
        )

    return DetectionAnalysisSummaryResponse(
        period_days=days,  # type: ignore[arg-type]
        period_start=period_start,
        period_end=period_end,
        generated_at=period_end,
        total_analyses=total,
        completed_count=len(completed_events),
        failed_count=failed_count,
        in_progress_count=in_progress_count,
        completion_rate=_round_percent(len(completed_events), total),
        image_count=image_count,
        video_count=video_count,
        total_detected_objects=object_total,
        average_confidence=round(float(confidence_sum / object_total), 4) if object_total else None,
        class_distribution=[
            DetectionClassDistributionItem(
                class_code=code,
                class_name_ko=class_names[code],
                count=class_counts.get(code, 0),
                ratio=_round_ratio(class_counts.get(code, 0), object_total),
            )
            for code in CLASS_ORDER
        ],
        confidence_distribution=[
            DetectionConfidenceDistributionItem(
                code=code,  # type: ignore[arg-type]
                label=label,
                count=confidence_counts.get(code, 0),
                ratio=_round_ratio(confidence_counts.get(code, 0), object_total),
            )
            for code, label in CONFIDENCE_BUCKETS
        ],
        daily_trend=[
            DetectionDailyTrendItem(date=date, analysis_count=values["analysis_count"], object_count=values["object_count"])
            for date, values in trend.items()
        ],
        recent_events=recent_events,
    )
