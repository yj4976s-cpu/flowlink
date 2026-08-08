from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    FoundItem,
    LostReport,
    MatchCandidate,
    Notification,
    ObjectClass,
    OwnershipClaim,
    ProcessingHistory,
    User,
)

PUBLIC_FOUND_ITEM_STATUSES = ("RECOVERED", "AVAILABLE")
MATCHABLE_FOUND_ITEM_STATUSES = ("AVAILABLE",)
ACTIVE_OWNERSHIP_CLAIM_STATUSES = ("PENDING", "APPROVED")
PERSONAL_ITEM_GROUP = "PERSONAL_ITEM"


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
        .options(joinedload(FoundItem.object_class))
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

    return db.scalars(statement.order_by(FoundItem.found_at.desc()).offset(skip).limit(limit)).all()


def get_public_found_item_by_id(db: Session, found_item_id: int) -> FoundItem | None:
    statement = _public_found_items_statement().where(FoundItem.id == found_item_id)
    return db.scalar(statement)


def get_found_item_by_id(db: Session, found_item_id: int) -> FoundItem | None:
    statement = (
        select(FoundItem)
        .options(joinedload(FoundItem.object_class))
        .where(FoundItem.id == found_item_id)
    )
    return db.scalar(statement)


def get_claimable_found_item_by_id(db: Session, found_item_id: int) -> FoundItem | None:
    statement = (
        select(FoundItem)
        .options(joinedload(FoundItem.object_class))
        .where(
            FoundItem.id == found_item_id,
            FoundItem.is_public.is_(True),
            FoundItem.status == "AVAILABLE",
        )
    )
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


def list_matches_for_user(db: Session, user_id: int, *, skip: int, limit: int) -> Sequence[MatchCandidate]:
    statement = (
        select(MatchCandidate)
        .join(MatchCandidate.lost_report)
        .options(
            joinedload(MatchCandidate.lost_report).joinedload(LostReport.object_class),
            joinedload(MatchCandidate.found_item).joinedload(FoundItem.object_class),
        )
        .where(LostReport.user_id == user_id)
        .order_by(MatchCandidate.total_score.desc(), MatchCandidate.created_at.desc())
        .offset(skip)
        .limit(limit)
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


def get_notification_for_user(db: Session, notification_id: int, user_id: int) -> Notification | None:
    # 알림 id는 전역 식별자이므로 user_id 조건을 같이 걸어 타인의 read_at 변경을 막는다.
    statement = select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    )
    return db.scalar(statement)
