from datetime import UTC, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.security import utc_now
from app.db.session import get_db
from app.models import CitizenReport, DetectedObject, DetectionEvent, FoundItem, MatchCandidate
from app.repositories.user_flow import KST, PUBLIC_FOUND_ITEM_STATUSES
from app.schemas.common import HealthResponse
from app.schemas.home import HomeRecentItemResponse, HomeStatsResponse, HomeSummaryResponse
from app.services.found_item_images import representative_found_item_image_url

router = APIRouter(tags=["system"])

HOME_RECENT_LIMIT = 4


def _today_kst_range() -> tuple[datetime, datetime]:
    today = utc_now().astimezone(KST).date()
    start = datetime.combine(today, time.min, tzinfo=KST).astimezone(UTC)
    end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=KST).astimezone(UTC)
    return start, end


def _public_home_found_item_filters():
    return (
        FoundItem.is_public.is_(True),
        FoundItem.status.in_(PUBLIC_FOUND_ITEM_STATUSES),
        ~FoundItem.citizen_reports.any(CitizenReport.status == "CANCELLED"),
    )


def _safe_object_kind(code: str | None, name: str | None) -> str:
    value = f"{code or ''} {name or ''}".upper()
    if "BAG" in value or "BACKPACK" in value:
        return "backpack"
    if "UMBRELLA" in value:
        return "umbrella"
    if "BALL" in value or "공" in (name or ""):
        return "ball"
    if "BRANCH" in value or "TREE" in value:
        return "branch"
    return "container"


def _item_title(item: FoundItem) -> str:
    if item.public_description:
        return item.public_description
    return " ".join(part for part in (item.color, item.object_class.name_ko) if part) or item.object_class.name_ko


def _confidence_percent(item: FoundItem) -> int | None:
    confidence = item.detected_object.confidence if item.detected_object else None
    return round(float(confidence) * 100) if confidence is not None else None


@router.get("/health", response_model=HealthResponse, summary="서비스 상태 확인")
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="flowlink-api", version="0.1.0")


@router.get("/api/system/home-summary", response_model=HomeSummaryResponse, summary="공개 홈 요약")
def home_summary(db: Annotated[Session, Depends(get_db)]) -> HomeSummaryResponse:
    today_start, today_end = _today_kst_range()
    filters = _public_home_found_item_filters()
    stats = HomeStatsResponse(
        recent_found=db.scalar(select(func.count()).select_from(FoundItem).where(*filters)) or 0,
        matching_active=db.scalar(select(func.count()).select_from(MatchCandidate).where(MatchCandidate.status != "DISMISSED")) or 0,
        returned=db.scalar(
            select(func.count()).select_from(FoundItem).where(
                FoundItem.is_public.is_(True),
                FoundItem.status == "RETURNED",
                ~FoundItem.citizen_reports.any(CitizenReport.status == "CANCELLED"),
            )
        ) or 0,
        today_detections=db.scalar(
            select(func.count()).select_from(DetectionEvent).where(
                DetectionEvent.created_at >= today_start,
                DetectionEvent.created_at < today_end,
            )
        ) or 0,
    )
    items = db.scalars(
        select(FoundItem)
        .options(
            joinedload(FoundItem.object_class),
            joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event),
            selectinload(FoundItem.citizen_reports),
        )
        .where(*filters)
        .order_by(FoundItem.found_at.desc(), FoundItem.id.desc())
        .limit(HOME_RECENT_LIMIT)
    ).all()
    return HomeSummaryResponse(
        stats=stats,
        recent_items=[
            HomeRecentItemResponse(
                id=item.id,
                category=item.object_class.name_ko,
                title=_item_title(item),
                location=item.area_name,
                image_url=representative_found_item_image_url(item),
                confidence=_confidence_percent(item),
                found_at=item.found_at,
                object_kind=_safe_object_kind(item.object_class.code, item.object_class.name_ko),
            )
            for item in items
        ],
    )
