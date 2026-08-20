from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import Select, String, and_, case, cast, func, or_, select
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from app.services.found_item_images import representative_found_item_image_url

from app.models import (
    DetectedObject,
    DetectionEvent,
    CitizenReport,
    CitizenSighting,
    FoundItem,
    LostReport,
    MatchCandidate,
    Notification,
    ObjectClass,
    OwnershipClaim,
    ProcessingHistory,
    User,
)

KST = ZoneInfo("Asia/Seoul")

PUBLIC_FOUND_ITEM_STATUSES = ("RECOVERED", "AVAILABLE")
MATCHABLE_FOUND_ITEM_STATUSES = ("AVAILABLE",)
FOUND_ITEM_LIFECYCLE_STATUSES = ("DETECTED", "RECOVERED", "AVAILABLE", "CLAIM_PENDING", "RETURNED", "DISPOSED")
ACTIVE_OWNERSHIP_CLAIM_STATUSES = ("PENDING", "APPROVED")
PERSONAL_ITEM_GROUP = "PERSONAL_ITEM"
WASTE_GROUP = "WASTE"


def get_admin_ai_report_data(db: Session) -> dict:
    reviewed = DetectedObject.processing_status.in_(("CONFIRMED", "REJECTED"))
    corrected = and_(
        DetectedObject.processing_status == "CONFIRMED",
        DetectedObject.final_class_code.is_not(None),
        DetectedObject.final_class_code != ObjectClass.code,
    )
    operational = DetectionEvent.purpose == "OPERATION"
    base_join = (
        DetectedObject.__table__
        .join(DetectionEvent.__table__, DetectedObject.detection_event_id == DetectionEvent.id)
        .join(ObjectClass.__table__, DetectedObject.object_class_id == ObjectClass.id)
    )

    summary = db.execute(
        select(
            func.count(DetectedObject.id),
            func.avg(DetectedObject.confidence),
            func.sum(case((reviewed, 1), else_=0)),
            func.sum(case((corrected, 1), else_=0)),
        ).select_from(base_join).where(operational)
    ).one()

    class_rows = db.execute(
        select(
            ObjectClass.code,
            ObjectClass.name_ko,
            func.count(DetectedObject.id).label("detection_count"),
            func.avg(DetectedObject.confidence).label("average_confidence"),
            func.sum(case((reviewed, 1), else_=0)).label("reviewed_count"),
            func.sum(case((corrected, 1), else_=0)).label("corrected_count"),
        )
        .select_from(base_join)
        .where(operational)
        .group_by(ObjectClass.code, ObjectClass.name_ko)
        .order_by(func.count(DetectedObject.id).desc(), ObjectClass.code)
    ).all()

    bucket = case(
        (DetectedObject.confidence < Decimal("0.5"), "under_05"),
        (DetectedObject.confidence < Decimal("0.6"), "05_06"),
        (DetectedObject.confidence < Decimal("0.7"), "06_07"),
        (DetectedObject.confidence < Decimal("0.8"), "07_08"),
        (DetectedObject.confidence < Decimal("0.9"), "08_09"),
        else_="09_10",
    )
    bucket_counts = dict(db.execute(
        select(bucket, func.count(DetectedObject.id))
        .select_from(DetectedObject.__table__.join(DetectionEvent.__table__))
        .where(operational)
        .group_by(bucket)
    ).all())
    bucket_labels = (
        ("under_05", "0.0 이상 0.5 미만"), ("05_06", "0.5 이상 0.6 미만"),
        ("06_07", "0.6 이상 0.7 미만"), ("07_08", "0.7 이상 0.8 미만"),
        ("08_09", "0.8 이상 0.9 미만"), ("09_10", "0.9 이상 1.0 이하"),
    )

    final_class = aliased(ObjectClass)
    correction_rows = db.execute(
        select(
            ObjectClass.code, ObjectClass.name_ko,
            final_class.code, final_class.name_ko,
            func.count(DetectedObject.id).label("count"),
        )
        .join(DetectedObject, DetectedObject.object_class_id == ObjectClass.id)
        .join(DetectionEvent, DetectedObject.detection_event_id == DetectionEvent.id)
        .join(final_class, DetectedObject.final_class_code == final_class.code)
        .where(operational, corrected)
        .group_by(ObjectClass.code, ObjectClass.name_ko, final_class.code, final_class.name_ko)
        .order_by(func.count(DetectedObject.id).desc(), ObjectClass.code, final_class.code)
    ).all()

    return {
        "summary": {"total": summary[0], "average_confidence": summary[1], "reviewed": summary[2] or 0, "corrected": summary[3] or 0},
        "class_metrics": [{"code": row[0], "name": row[1], "count": row[2], "average_confidence": row[3], "reviewed": row[4] or 0, "corrected": row[5] or 0} for row in class_rows],
        "confidence_distribution": [{"key": key, "label": label, "count": bucket_counts.get(key, 0)} for key, label in bucket_labels],
        "correction_patterns": [{"predicted_code": row[0], "predicted_name": row[1], "final_code": row[2], "final_name": row[3], "count": row[4]} for row in correction_rows],
    }


def normalize_object_code(value: str) -> str:
    return value.strip().upper()


def clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def get_user_by_email(db: Session, email: str) -> User | None:
    statement = select(User).where(func.lower(User.email) == email.lower())
    return db.scalar(statement)


def get_object_class_by_code(db: Session, code: str) -> ObjectClass | None:
    statement = select(ObjectClass).where(ObjectClass.code == normalize_object_code(code))
    return db.scalar(statement)


def get_active_personal_object_class(db: Session, code: str) -> ObjectClass | None:
    statement = select(ObjectClass).where(
        ObjectClass.code == normalize_object_code(code),
        ObjectClass.is_active.is_(True),
        ObjectClass.group_code == PERSONAL_ITEM_GROUP,
    )
    return db.scalar(statement)


def _public_found_items_statement() -> Select[tuple[FoundItem]]:
    return (
        select(FoundItem)
        .options(joinedload(FoundItem.object_class), joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event), selectinload(FoundItem.citizen_reports))
        .where(
            FoundItem.is_public.is_(True),
            FoundItem.status.in_(PUBLIC_FOUND_ITEM_STATUSES),
        )
    )


def list_public_found_items(
    db: Session,
    *,
    skip: int,
    limit: int,
    item_category: str | None = None,
    color: str | None = None,
    area_name: str | None = None,
    q: str | None = None,
    status: str | None = None,
    found_date: datetime | None = None,
) -> Sequence[FoundItem]:
    statement = _public_found_items_statement().join(FoundItem.object_class)
    if item_category:
        category = item_category.strip()
        category_code = normalize_object_code(category)
        statement = statement.where(
            or_(
                ObjectClass.code == category_code,
                func.lower(ObjectClass.name_ko) == category.lower(),
            )
        )
    if color:
        statement = statement.where(func.lower(FoundItem.color) == color.strip().lower())
    if area_name:
        statement = statement.where(func.lower(FoundItem.area_name) == area_name.strip().lower())
    if q:
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                FoundItem.public_description.ilike(pattern),
                FoundItem.area_name.ilike(pattern),
                FoundItem.color.ilike(pattern),
                ObjectClass.name_ko.ilike(pattern),
                ObjectClass.code.ilike(pattern),
            )
        )
    if status:
        statement = statement.where(FoundItem.status == status.strip().upper())
    if found_date:
        start = found_date.replace(tzinfo=KST).astimezone(UTC)
        end = (found_date + timedelta(days=1)).replace(tzinfo=KST).astimezone(UTC)
        statement = statement.where(FoundItem.found_at >= start, FoundItem.found_at < end)

    return db.scalars(statement.order_by(FoundItem.found_at.desc()).offset(skip).limit(limit)).all()


def list_public_found_items_for_map(db: Session, *, limit: int) -> Sequence[FoundItem]:
    statement = _public_found_items_statement().where(
        FoundItem.latitude.is_not(None),
        FoundItem.longitude.is_not(None),
    )
    return db.scalars(statement.order_by(FoundItem.found_at.desc()).limit(limit)).all()


def get_public_found_item_by_id(db: Session, found_item_id: int) -> FoundItem | None:
    statement = _public_found_items_statement().where(FoundItem.id == found_item_id)
    return db.scalar(statement)


def get_found_item_by_id(
    db: Session,
    found_item_id: int,
    *,
    for_update: bool = False,
) -> FoundItem | None:
    statement = select(FoundItem).where(FoundItem.id == found_item_id)
    if for_update:
        statement = statement.with_for_update(of=FoundItem)
    else:
        statement = statement.options(
            joinedload(FoundItem.object_class),
            joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event),
            selectinload(FoundItem.citizen_reports),
        )
    return db.scalar(statement)


def list_admin_found_items(
    db: Session,
    *,
    skip: int,
    limit: int,
    status: str | None = None,
    item_category: str | None = None,
    q: str | None = None,
    found_date: datetime | None = None,
) -> tuple[Sequence[FoundItem], int, dict[str, int]]:
    conditions = []
    if item_category:
        category = item_category.strip()
        conditions.append(or_(ObjectClass.code == normalize_object_code(category), func.lower(ObjectClass.name_ko) == category.lower()))
    if q:
        normalized = q.strip()
        pattern = f"%{normalized}%"
        id_condition = cast(FoundItem.id, String).ilike(pattern) if normalized else False
        conditions.append(or_(id_condition, ObjectClass.code.ilike(pattern), ObjectClass.name_ko.ilike(pattern), FoundItem.area_name.ilike(pattern), FoundItem.storage_location.ilike(pattern)))
    if found_date:
        start = found_date.replace(tzinfo=KST).astimezone(UTC)
        end = (found_date + timedelta(days=1)).replace(tzinfo=KST).astimezone(UTC)
        conditions.extend((FoundItem.found_at >= start, FoundItem.found_at < end))

    filtered_conditions = [*conditions]
    if status:
        filtered_conditions.append(FoundItem.status == status)
    total = int(db.scalar(select(func.count(FoundItem.id)).join(FoundItem.object_class).where(*filtered_conditions)) or 0)
    rows = db.scalars(
        select(FoundItem)
        .join(FoundItem.object_class)
        .options(joinedload(FoundItem.object_class), joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event), selectinload(FoundItem.citizen_reports))
        .where(*filtered_conditions)
        .order_by(FoundItem.updated_at.desc(), FoundItem.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    grouped = dict(db.execute(
        select(FoundItem.status, func.count(FoundItem.id))
        .join(FoundItem.object_class)
        .where(*conditions, FoundItem.status.in_(FOUND_ITEM_LIFECYCLE_STATUSES))
        .group_by(FoundItem.status)
    ).all())
    return rows, total, {value: int(grouped.get(value, 0)) for value in FOUND_ITEM_LIFECYCLE_STATUSES}


def get_claimable_found_item_by_id(
    db: Session,
    found_item_id: int,
    *,
    for_update: bool = False,
) -> FoundItem | None:
    statement = (
        select(FoundItem)
        .where(
            FoundItem.id == found_item_id,
            FoundItem.is_public.is_(True),
            FoundItem.status == "AVAILABLE",
        )
    )
    if for_update:
        statement = statement.with_for_update(of=FoundItem)
    return db.scalar(statement)


def add_lost_report(db: Session, lost_report: LostReport) -> LostReport:
    db.add(lost_report)
    db.flush()
    return lost_report


def list_lost_reports_for_user(db: Session, user_id: int, *, skip: int, limit: int) -> Sequence[LostReport]:
    statement = (
        select(LostReport)
        .options(joinedload(LostReport.object_class))
        .where(LostReport.user_id == user_id)
        .order_by(LostReport.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(statement).all()


def get_lost_report_for_user(db: Session, lost_report_id: int, user_id: int) -> LostReport | None:
    # ID만 알고 타인의 신고를 조회하는 IDOR를 막기 위해 id와 소유자를 항상 함께 확인한다.
    statement = (
        select(LostReport)
        .options(joinedload(LostReport.object_class))
        .where(LostReport.id == lost_report_id, LostReport.user_id == user_id)
    )
    return db.scalar(statement)


def get_lost_report_by_id(db: Session, lost_report_id: int) -> LostReport | None:
    statement = (
        select(LostReport)
        .options(joinedload(LostReport.object_class))
        .where(LostReport.id == lost_report_id)
    )
    return db.scalar(statement)


def list_matchable_found_items(db: Session, object_class_id: int) -> Sequence[FoundItem]:
    statement = (
        select(FoundItem)
        .options(joinedload(FoundItem.object_class))
        .where(
            FoundItem.is_public.is_(True),
            FoundItem.status.in_(MATCHABLE_FOUND_ITEM_STATUSES),
            FoundItem.object_class_id == object_class_id,
        )
        .order_by(FoundItem.found_at.desc())
    )
    return db.scalars(statement).all()


def match_candidate_exists(db: Session, lost_report_id: int, found_item_id: int) -> bool:
    statement = select(MatchCandidate.id).where(
        MatchCandidate.lost_report_id == lost_report_id,
        MatchCandidate.found_item_id == found_item_id,
    )
    return db.scalar(statement) is not None


def add_match_candidate(db: Session, candidate: MatchCandidate) -> MatchCandidate:
    db.add(candidate)
    db.flush()
    return candidate


def list_matches_for_user(
    db: Session,
    user_id: int,
    *,
    lost_report_id: int | None = None,
    skip: int,
    limit: int,
) -> Sequence[MatchCandidate]:
    statement = (
        select(MatchCandidate)
        .join(MatchCandidate.lost_report)
        .join(MatchCandidate.found_item)
        .options(
            joinedload(MatchCandidate.lost_report).joinedload(LostReport.object_class),
            joinedload(MatchCandidate.found_item).joinedload(FoundItem.object_class),
            joinedload(MatchCandidate.found_item).joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event),
            joinedload(MatchCandidate.found_item).selectinload(FoundItem.citizen_reports),
        )
        .where(
            LostReport.user_id == user_id,
            MatchCandidate.status != "DISMISSED",
            or_(
                MatchCandidate.status == "CLAIMED",
                FoundItem.status.in_(MATCHABLE_FOUND_ITEM_STATUSES),
            ),
        )
    )
    if lost_report_id is not None:
        statement = statement.where(MatchCandidate.lost_report_id == lost_report_id)
    statement = statement.order_by(
        MatchCandidate.total_score.desc(),
        MatchCandidate.created_at.desc(),
        MatchCandidate.id.desc(),
    ).offset(skip).limit(limit)
    return db.scalars(statement).all()


def list_matches_for_user_reports(
    db: Session,
    user_id: int,
    lost_report_ids: Sequence[int],
) -> Sequence[MatchCandidate]:
    if not lost_report_ids:
        return []
    statement = (
        select(MatchCandidate)
        .join(MatchCandidate.lost_report)
        .join(MatchCandidate.found_item)
        .options(
            joinedload(MatchCandidate.lost_report).joinedload(LostReport.object_class),
            joinedload(MatchCandidate.found_item).joinedload(FoundItem.object_class),
            joinedload(MatchCandidate.found_item).joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event),
            joinedload(MatchCandidate.found_item).selectinload(FoundItem.citizen_reports),
        )
        .where(
            LostReport.user_id == user_id,
            MatchCandidate.lost_report_id.in_(lost_report_ids),
            MatchCandidate.status != "DISMISSED",
            or_(
                MatchCandidate.status == "CLAIMED",
                FoundItem.status.in_(MATCHABLE_FOUND_ITEM_STATUSES),
            ),
        )
        .order_by(
            MatchCandidate.lost_report_id,
            MatchCandidate.total_score.desc(),
            MatchCandidate.created_at.desc(),
            MatchCandidate.id.desc(),
        )
    )
    return db.scalars(statement).all()


def add_notification(db: Session, notification: Notification) -> Notification:
    db.add(notification)
    db.flush()
    return notification


def get_existing_ownership_claim(
    db: Session,
    *,
    user_id: int,
    found_item_id: int,
    lost_report_id: int | None,
) -> OwnershipClaim | None:
    statement = select(OwnershipClaim).where(
        OwnershipClaim.user_id == user_id,
        OwnershipClaim.found_item_id == found_item_id,
    )
    if lost_report_id is None:
        statement = statement.where(OwnershipClaim.lost_report_id.is_(None))
    else:
        statement = statement.where(OwnershipClaim.lost_report_id == lost_report_id)
    return db.scalar(statement)


def add_ownership_claim(db: Session, claim: OwnershipClaim) -> OwnershipClaim:
    db.add(claim)
    db.flush()
    return claim


def get_match_candidate(db: Session, *, lost_report_id: int, found_item_id: int) -> MatchCandidate | None:
    return db.scalar(
        select(MatchCandidate).where(
            MatchCandidate.lost_report_id == lost_report_id,
            MatchCandidate.found_item_id == found_item_id,
        )
    )


def list_detection_events(db: Session, *, skip: int, limit: int) -> Sequence[DetectionEvent]:
    return db.scalars(
        select(DetectionEvent)
        .options(
            joinedload(DetectionEvent.camera),
            selectinload(DetectionEvent.detected_objects).joinedload(DetectedObject.object_class),
            selectinload(DetectionEvent.detected_objects).joinedload(DetectedObject.final_class),
            selectinload(DetectionEvent.detected_objects).joinedload(DetectedObject.found_item),
        )
        .where(DetectionEvent.purpose == "OPERATION")
        .order_by(DetectionEvent.captured_at.desc(), DetectionEvent.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()


def get_detected_object_by_id(db: Session, detected_object_id: int, *, for_update: bool = False) -> DetectedObject | None:
    statement = (
        select(DetectedObject)
        .options(
            joinedload(DetectedObject.object_class),
            joinedload(DetectedObject.final_class),
            joinedload(DetectedObject.found_item),
            joinedload(DetectedObject.detection_event).joinedload(DetectionEvent.camera),
        )
        .where(DetectedObject.id == detected_object_id)
    )
    if for_update:
        statement = statement.with_for_update(of=DetectedObject)
    return db.scalar(statement)


def waste_collection_completed_ids(db: Session, detected_object_ids: list[int]) -> set[int]:
    if not detected_object_ids:
        return set()
    return set(db.scalars(
        select(ProcessingHistory.entity_id).where(
            ProcessingHistory.entity_type == "DETECTED_OBJECT",
            ProcessingHistory.entity_id.in_(detected_object_ids),
            ProcessingHistory.action_type == "WASTE_COLLECTION_COMPLETED",
        )
    ).all())


def has_other_active_ownership_claim(db: Session, *, found_item_id: int, claim_id: int) -> bool:
    statement = select(OwnershipClaim.id).where(
        OwnershipClaim.found_item_id == found_item_id,
        OwnershipClaim.id != claim_id,
        OwnershipClaim.status.in_(ACTIVE_OWNERSHIP_CLAIM_STATUSES),
    )
    return db.scalar(statement) is not None


def list_ownership_claims(db: Session, *, skip: int, limit: int) -> Sequence[OwnershipClaim]:
    statement = (
        select(OwnershipClaim)
        .options(
            joinedload(OwnershipClaim.user),
            joinedload(OwnershipClaim.lost_report).joinedload(LostReport.object_class),
            joinedload(OwnershipClaim.found_item).joinedload(FoundItem.object_class),
        )
        .order_by(OwnershipClaim.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(statement).all()


def list_ownership_claims_for_user(
    db: Session,
    user_id: int,
    *,
    skip: int,
    limit: int,
) -> Sequence[OwnershipClaim]:
    statement = (
        select(OwnershipClaim)
        .where(OwnershipClaim.user_id == user_id)
        .order_by(OwnershipClaim.created_at.desc(), OwnershipClaim.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(statement).all()


def list_representative_ownership_claims_for_user_reports(
    db: Session,
    user_id: int,
    lost_report_ids: Sequence[int],
) -> Sequence[OwnershipClaim]:
    if not lost_report_ids:
        return []
    priority = case(
        (OwnershipClaim.status == "RETURNED", 3),
        (OwnershipClaim.status == "APPROVED", 2),
        (OwnershipClaim.status == "PENDING", 1),
        (OwnershipClaim.status == "REJECTED", 0),
        else_=-1,
    )
    ranked = (
        select(
            OwnershipClaim.id.label("claim_id"),
            func.row_number().over(
                partition_by=OwnershipClaim.lost_report_id,
                order_by=(priority.desc(), OwnershipClaim.created_at.desc(), OwnershipClaim.id.desc()),
            ).label("claim_rank"),
        )
        .join(LostReport, LostReport.id == OwnershipClaim.lost_report_id)
        .where(
            OwnershipClaim.user_id == user_id,
            LostReport.user_id == user_id,
            OwnershipClaim.lost_report_id.in_(lost_report_ids),
        )
        .subquery()
    )
    statement = (
        select(OwnershipClaim)
        .join(ranked, ranked.c.claim_id == OwnershipClaim.id)
        .where(ranked.c.claim_rank == 1)
        .order_by(OwnershipClaim.lost_report_id, OwnershipClaim.id)
    )
    return db.scalars(statement).all()


def list_ownership_claims_for_user_reports(
    db: Session,
    user_id: int,
    lost_report_ids: Sequence[int],
) -> Sequence[OwnershipClaim]:
    if not lost_report_ids:
        return []
    statement = (
        select(OwnershipClaim)
        .join(LostReport, LostReport.id == OwnershipClaim.lost_report_id)
        .where(
            OwnershipClaim.user_id == user_id,
            LostReport.user_id == user_id,
            OwnershipClaim.lost_report_id.in_(lost_report_ids),
        )
        .order_by(OwnershipClaim.created_at.desc(), OwnershipClaim.id.desc())
    )
    return db.scalars(statement).all()


def get_ownership_claim_by_id(db: Session, claim_id: int) -> OwnershipClaim | None:
    statement = (
        select(OwnershipClaim)
        .options(
            joinedload(OwnershipClaim.user),
            joinedload(OwnershipClaim.lost_report).joinedload(LostReport.object_class),
            joinedload(OwnershipClaim.found_item).joinedload(FoundItem.object_class),
        )
        .where(OwnershipClaim.id == claim_id)
    )
    return db.scalar(statement)


def add_processing_history(db: Session, history: ProcessingHistory) -> ProcessingHistory:
    db.add(history)
    db.flush()
    return history


def list_notifications_for_user(
    db: Session,
    user_id: int,
    *,
    skip: int,
    limit: int,
    unread_only: bool = False,
) -> Sequence[Notification]:
    statement = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    statement = statement.order_by(Notification.created_at.desc()).offset(skip).limit(limit)
    return db.scalars(statement).all()


def _as_kst(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(KST)


def get_admin_dashboard_data(db: Session, *, since, period: str = "today", now=None) -> dict:
    personal_items = FoundItem.object_class_id.in_(
        select(ObjectClass.id).where(ObjectClass.group_code == PERSONAL_ITEM_GROUP)
    )
    original_class = aliased(ObjectClass)
    final_class = aliased(ObjectClass)
    waste_collection_completed = (
        select(ProcessingHistory.id)
        .where(
            ProcessingHistory.entity_type == "DETECTED_OBJECT",
            ProcessingHistory.entity_id == DetectedObject.id,
            ProcessingHistory.action_type == "WASTE_COLLECTION_COMPLETED",
        )
        .exists()
    )
    effective_waste_class = or_(
        and_(DetectedObject.final_class_code.is_not(None), final_class.group_code == WASTE_GROUP),
        and_(DetectedObject.final_class_code.is_(None), original_class.group_code == WASTE_GROUP),
    )

    def count(model, *conditions) -> int:
        return int(db.scalar(select(func.count(model.id)).where(*conditions)) or 0)

    def period_condition(column):
        return column >= since if since is not None else True

    def waste_collection_pending_count() -> int:
        statement = (
            select(func.count(DetectedObject.id))
            .join(DetectionEvent, DetectedObject.detection_event_id == DetectionEvent.id)
            .join(original_class, DetectedObject.object_class_id == original_class.id)
            .outerjoin(final_class, DetectedObject.final_class_code == final_class.code)
            .where(
                DetectionEvent.purpose == "OPERATION",
                DetectedObject.processing_status == "CONFIRMED",
                effective_waste_class,
                ~waste_collection_completed,
            )
        )
        return int(db.scalar(statement) or 0)

    found_items = db.scalars(
        select(FoundItem)
        .options(
            joinedload(FoundItem.object_class),
            joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event),
            selectinload(FoundItem.citizen_reports),
        )
        .where(period_condition(FoundItem.created_at), personal_items)
        .order_by(FoundItem.created_at.desc())
        .limit(4)
    ).all()
    detections = db.scalars(
        select(DetectedObject)
        .options(
            joinedload(DetectedObject.object_class),
            joinedload(DetectedObject.detection_event),
        )
        .where(
            period_condition(DetectedObject.detected_at),
            DetectedObject.detection_event.has(DetectionEvent.purpose == "OPERATION"),
        )
        .order_by(DetectedObject.detected_at.desc(), DetectedObject.id.desc())
        .limit(4)
    ).all()
    category_rows = db.execute(
        select(ObjectClass.code, ObjectClass.name_ko, func.count(DetectedObject.id))
        .join(DetectedObject, DetectedObject.object_class_id == ObjectClass.id)
        .join(DetectionEvent, DetectedObject.detection_event_id == DetectionEvent.id)
        .where(
            period_condition(DetectedObject.detected_at),
            DetectionEvent.purpose == "OPERATION",
            ObjectClass.group_code == PERSONAL_ITEM_GROUP,
        )
        .group_by(ObjectClass.code, ObjectClass.name_ko)
        .order_by(func.count(DetectedObject.id).desc())
    ).all()
    claim_status_rows = db.execute(
        select(OwnershipClaim.status, func.count(OwnershipClaim.id))
        .where(period_condition(OwnershipClaim.created_at))
        .group_by(OwnershipClaim.status)
        .order_by(OwnershipClaim.status)
    ).all()
    histories = db.scalars(
        select(ProcessingHistory)
        .where(period_condition(ProcessingHistory.created_at))
        .order_by(ProcessingHistory.created_at.desc())
        .limit(7)
    ).all()
    found_dates = list(db.scalars(select(FoundItem.created_at).where(period_condition(FoundItem.created_at), personal_items)).all())
    match_dates = list(db.scalars(select(MatchCandidate.created_at).where(period_condition(MatchCandidate.created_at))).all())
    return_dates = list(db.scalars(select(OwnershipClaim.updated_at).where(period_condition(OwnershipClaim.updated_at), OwnershipClaim.status == "RETURNED")).all())
    all_dates = found_dates + match_dates + return_dates
    if period == "today":
        labels = [f"{hour:02d}시" for hour in range(0, 24, 3)]
        key = lambda value: f"{(_as_kst(value).hour // 3) * 3:02d}시"
    else:
        dates = []
        if period == "7d" and since is not None:
            dates = [(since.date() + timedelta(days=index)) for index in range(7)]
        elif all_dates:
            start, end = min(_as_kst(value).date() for value in all_dates), max(_as_kst(value).date() for value in all_dates)
            dates = [start + timedelta(days=index) for index in range((end - start).days + 1)]
        labels = [value.strftime("%m.%d") for value in dates]
        key = lambda value: _as_kst(value).strftime("%m.%d")
    def grouped(values):
        result = {label: 0 for label in labels}
        for value in values:
            label = key(value)
            if label in result:
                result[label] += 1
        return result
    found_group, match_group, return_group = grouped(found_dates), grouped(match_dates), grouped(return_dates)
    average_confidence = db.scalar(
        select(func.avg(DetectedObject.confidence)).where(
            period_condition(DetectedObject.detected_at),
            DetectedObject.detection_event.has(DetectionEvent.purpose == "OPERATION"),
        )
    )
    latest_match = db.scalar(
        select(MatchCandidate)
        .options(joinedload(MatchCandidate.found_item).joinedload(FoundItem.detected_object))
        .where(MatchCandidate.status != "DISMISSED")
        .order_by(MatchCandidate.created_at.desc(), MatchCandidate.id.desc())
        .limit(1)
    )
    latest_notification = None
    latest_claim = None
    if latest_match is not None:
        latest_notification = db.scalar(
            select(Notification).where(
                Notification.notification_type == "MATCH_FOUND",
                Notification.related_type == "MATCH_CANDIDATE",
                Notification.related_id == latest_match.id,
            ).order_by(Notification.id.desc()).limit(1)
        )
        latest_claim = db.scalar(
            select(OwnershipClaim).where(
                OwnershipClaim.found_item_id == latest_match.found_item_id,
                OwnershipClaim.lost_report_id == latest_match.lost_report_id,
            ).order_by(OwnershipClaim.created_at.desc(), OwnershipClaim.id.desc()).limit(1)
        )

    activity_rows: list[dict] = []
    for user_id, nickname, occurred_at in db.execute(
        select(User.id, User.nickname, User.last_login_at)
        .where(User.last_login_at.is_not(None), User.deleted_at.is_(None))
        .order_by(User.last_login_at.desc()).limit(3)
    ).all():
        activity_rows.append({"kind": "LOGIN", "entity_id": user_id, "label": nickname, "occurred_at": occurred_at})
    for model, kind, label, timestamp in (
        (LostReport, "LOST_REPORT", "분실 신고", LostReport.created_at),
        (MatchCandidate, "MATCH", "자동 매칭", MatchCandidate.created_at),
        (OwnershipClaim, "CLAIM", "소유권 요청", OwnershipClaim.created_at),
        (Notification, "NOTIFICATION", "사용자 알림", Notification.created_at),
    ):
        for entity_id, occurred_at in db.execute(select(model.id, timestamp).order_by(timestamp.desc()).limit(3)).all():
            activity_rows.append({"kind": kind, "entity_id": entity_id, "label": label, "occurred_at": occurred_at})
    activity_rows.sort(key=lambda item: item["occurred_at"], reverse=True)

    return {
        "period": period,
        "metrics": {
            "discovered": count(FoundItem, period_condition(FoundItem.created_at), personal_items),
            "ai_detections": count(DetectedObject, period_condition(DetectedObject.detected_at), DetectedObject.detection_event.has(DetectionEvent.purpose == "OPERATION")),
            "official_found_items": count(FoundItem, period_condition(FoundItem.created_at), personal_items),
            "confirmed": count(FoundItem, period_condition(FoundItem.created_at), personal_items, FoundItem.status.in_(("AVAILABLE", "RECOVERED", "CLAIM_PENDING", "RETURNED"))),
            "matched": count(MatchCandidate, period_condition(MatchCandidate.created_at)),
            "claims": count(OwnershipClaim, period_condition(OwnershipClaim.created_at)),
            "approved": count(OwnershipClaim, period_condition(OwnershipClaim.updated_at), OwnershipClaim.status.in_(("APPROVED", "RETURNED"))),
            "returned": count(OwnershipClaim, period_condition(OwnershipClaim.updated_at), OwnershipClaim.status == "RETURNED"),
            "lost_reports": count(LostReport, period_condition(LostReport.created_at)),
            "match_notifications": count(Notification, period_condition(Notification.created_at), Notification.notification_type == "MATCH_FOUND"),
            "citizen_reports": count(CitizenReport, period_condition(CitizenReport.created_at), CitizenReport.status != "CANCELLED"),
            "citizen_pending": count(CitizenReport, CitizenReport.status.in_(("PENDING", "UNDER_REVIEW"))),
            "operation_detection_pending": count(DetectedObject, DetectedObject.processing_status == "PENDING", DetectedObject.detection_event.has(DetectionEvent.purpose == "OPERATION")),
            "waste_collection_pending": waste_collection_pending_count(),
            "citizen_review_pending": count(CitizenReport, CitizenReport.status == "PENDING"),
            "ownership_claim_pending": count(OwnershipClaim, OwnershipClaim.status == "PENDING"),
            "ownership_return_pending": count(OwnershipClaim, OwnershipClaim.status == "APPROVED"),
            "citizen_linked": count(CitizenReport, period_condition(CitizenReport.linked_at), CitizenReport.status == "LINKED"),
            "citizen_sightings": count(CitizenSighting, period_condition(CitizenSighting.created_at)),
        },
        "recent_items": [
            {"id": item.id, "item_category": item.object_class.code, "item_category_name": item.object_class.name_ko, "color": item.color, "public_description": item.public_description, "area_name": item.area_name, "found_at": item.found_at, "status": item.status, "image_url": representative_found_item_image_url(item)}
            for item in found_items
        ],
        "recent_detections": [
            {"id": item.id, "detection_event_id": item.detection_event_id, "item_category": item.object_class.code, "item_category_name": item.object_class.name_ko, "confidence": item.confidence, "image_url": item.cropped_image_url or ((item.detection_event.result_media_url or item.detection_event.original_media_url) if item.detection_event.source_type == "IMAGE" else None), "detected_at": item.detected_at, "processing_status": item.processing_status}
            for item in detections
        ],
        "category_counts": [{"code": code, "name": name, "count": value} for code, name, value in category_rows],
        "claim_status_counts": [{"status": status, "count": value} for status, value in claim_status_rows],
        "average_confidence": Decimal(str(average_confidence)) if average_confidence is not None else None,
        "recent_history": [
            {"id": history.id, "entity_type": history.entity_type, "entity_id": history.entity_id, "action_type": history.action_type, "new_status": history.new_status, "note": history.note, "created_at": history.created_at}
            for history in histories
        ],
        "trend": [{"label": label, "discovered": found_group[label], "matched": match_group[label], "returned": return_group[label]} for label in labels],
        "latest_flow": None if latest_match is None else {
            "detection_id": latest_match.found_item.detected_object.detection_event_id if latest_match.found_item.detected_object else None,
            "detected_object_id": latest_match.found_item.detected_object_id,
            "found_item_id": latest_match.found_item_id,
            "lost_report_id": latest_match.lost_report_id,
            "match_candidate_id": latest_match.id,
            "notification_id": latest_notification.id if latest_notification else None,
            "ownership_claim_id": latest_claim.id if latest_claim else None,
            "returned": latest_claim is not None and latest_claim.status == "RETURNED",
        },
        "recent_activity": activity_rows[:8],
    }


def get_notification_for_user(db: Session, notification_id: int, user_id: int) -> Notification | None:
    # 알림 id는 전역 식별자이므로 user_id 조건을 같이 걸어 타인의 read_at 변경을 막는다.
    statement = select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    )
    return db.scalar(statement)
