from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import (
    AdminNotification,
    AdminNotificationRead,
    CitizenReport,
    DetectedObject,
    DetectionEvent,
    FoundItem,
    ObjectClass,
    OwnershipClaim,
    ProcessingHistory,
)

OPERATION_DETECTION_REVIEW_REQUIRED = "OPERATION_DETECTION_REVIEW_REQUIRED"
FOUND_ITEM_REGISTRATION_REQUIRED = "FOUND_ITEM_REGISTRATION_REQUIRED"
WASTE_COLLECTION_REQUIRED = "WASTE_COLLECTION_REQUIRED"
CITIZEN_REPORT_REVIEW_REQUIRED = "CITIZEN_REPORT_REVIEW_REQUIRED"
OWNERSHIP_CLAIM_REVIEW_REQUIRED = "OWNERSHIP_CLAIM_REVIEW_REQUIRED"
OWNERSHIP_RETURN_REQUIRED = "OWNERSHIP_RETURN_REQUIRED"

ADMIN_NOTIFICATION_TYPES = {
    OPERATION_DETECTION_REVIEW_REQUIRED,
    FOUND_ITEM_REGISTRATION_REQUIRED,
    WASTE_COLLECTION_REQUIRED,
    CITIZEN_REPORT_REVIEW_REQUIRED,
    OWNERSHIP_CLAIM_REVIEW_REQUIRED,
    OWNERSHIP_RETURN_REQUIRED,
}

PERSONAL_ITEM_GROUP = "PERSONAL_ITEM"
WASTE_GROUP = "WASTE"

AdminNotificationFilter = Literal["all", "unread", "actionable", "resolved"]


@dataclass(frozen=True)
class AdminNotificationPayload:
    notification_type: str
    title: str
    message: str
    related_type: str
    related_id: int


def _safe_payload(notification_type: str, related_type: str, related_id: int) -> AdminNotificationPayload:
    if notification_type == OPERATION_DETECTION_REVIEW_REQUIRED:
        return AdminNotificationPayload(
            notification_type=notification_type,
            title="새로운 운영 탐지 결과가 있습니다",
            message="관리자 검토가 필요한 탐지 객체가 등록되었습니다.",
            related_type=related_type,
            related_id=related_id,
        )
    if notification_type == FOUND_ITEM_REGISTRATION_REQUIRED:
        return AdminNotificationPayload(
            notification_type=notification_type,
            title="공식 발견물 등록이 필요합니다",
            message="검토가 완료된 개인 물품을 공식 발견물로 등록해 주세요.",
            related_type=related_type,
            related_id=related_id,
        )
    if notification_type == WASTE_COLLECTION_REQUIRED:
        return AdminNotificationPayload(
            notification_type=notification_type,
            title="폐기물 수거 확인이 필요합니다",
            message="확정된 폐기물의 현장 수거 상태를 확인해 주세요.",
            related_type=related_type,
            related_id=related_id,
        )
    if notification_type == CITIZEN_REPORT_REVIEW_REQUIRED:
        return AdminNotificationPayload(
            notification_type=notification_type,
            title="새로운 시민 발견 제보가 있습니다",
            message="관리자 검토가 필요한 시민 제보가 등록되었습니다.",
            related_type=related_type,
            related_id=related_id,
        )
    if notification_type == OWNERSHIP_CLAIM_REVIEW_REQUIRED:
        return AdminNotificationPayload(
            notification_type=notification_type,
            title="새로운 소유권 확인 요청이 있습니다",
            message="비공개 특징 확인이 필요한 소유권 요청이 등록되었습니다.",
            related_type=related_type,
            related_id=related_id,
        )
    if notification_type == OWNERSHIP_RETURN_REQUIRED:
        return AdminNotificationPayload(
            notification_type=notification_type,
            title="승인된 물품의 반환 확인이 필요합니다",
            message="소유권 승인이 완료된 물품의 실제 전달 상태를 확인해 주세요.",
            related_type=related_type,
            related_id=related_id,
        )
    raise ValueError("Unsupported admin notification type")


def _insert_ignore(db: Session, payload: AdminNotificationPayload, now: datetime) -> None:
    values = {
        "notification_type": payload.notification_type,
        "title": payload.title,
        "message": payload.message,
        "related_type": payload.related_type,
        "related_id": payload.related_id,
        "created_at": now,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = postgres_insert(AdminNotification).values(**values).on_conflict_do_nothing(
            index_elements=["notification_type", "related_type", "related_id"]
        )
    elif dialect == "sqlite":
        statement = sqlite_insert(AdminNotification).values(**values).on_conflict_do_nothing(
            index_elements=["notification_type", "related_type", "related_id"]
        )
    else:
        existing = db.scalar(
            select(AdminNotification.id).where(
                AdminNotification.notification_type == payload.notification_type,
                AdminNotification.related_type == payload.related_type,
                AdminNotification.related_id == payload.related_id,
            )
        )
        if existing is not None:
            return
        db.add(AdminNotification(**values))
        db.flush()
        return
    db.execute(statement)


def create_admin_notification_once(
    db: Session,
    *,
    notification_type: str,
    related_type: str,
    related_id: int,
    now: datetime | None = None,
) -> None:
    payload = _safe_payload(notification_type, related_type, related_id)
    _insert_ignore(db, payload, now or utc_now())


def resolve_admin_notification(
    db: Session,
    *,
    notification_type: str,
    related_type: str,
    related_id: int,
    now: datetime | None = None,
) -> None:
    notification = db.scalar(
        select(AdminNotification).where(
            AdminNotification.notification_type == notification_type,
            AdminNotification.related_type == related_type,
            AdminNotification.related_id == related_id,
            AdminNotification.resolved_at.is_(None),
        )
    )
    if notification is not None:
        notification.resolved_at = now or utc_now()


def _pending_operation_object_count(db: Session, event_id: int) -> int:
    return int(db.scalar(select(func.count(DetectedObject.id)).where(
        DetectedObject.detection_event_id == event_id,
        DetectedObject.processing_status == "PENDING",
    )) or 0)


def sync_detection_review_notification(db: Session, event: DetectionEvent) -> None:
    if event.purpose != "OPERATION" or event.status != "COMPLETED":
        return
    db.flush()
    if _pending_operation_object_count(db, event.id) > 0:
        create_admin_notification_once(
            db,
            notification_type=OPERATION_DETECTION_REVIEW_REQUIRED,
            related_type="DETECTION_EVENT",
            related_id=event.id,
        )
    else:
        resolve_admin_notification(
            db,
            notification_type=OPERATION_DETECTION_REVIEW_REQUIRED,
            related_type="DETECTION_EVENT",
            related_id=event.id,
        )


def _effective_group(item: DetectedObject) -> str:
    return (item.final_class or item.object_class).group_code


def _has_waste_collection_completed(db: Session, detected_object_id: int) -> bool:
    return bool(db.scalar(select(ProcessingHistory.id).where(
        ProcessingHistory.entity_type == "DETECTED_OBJECT",
        ProcessingHistory.entity_id == detected_object_id,
        ProcessingHistory.action_type == "WASTE_COLLECTION_COMPLETED",
    ).limit(1)))


def sync_detected_object_follow_up_notifications(db: Session, item: DetectedObject) -> None:
    event = item.detection_event
    db.flush()
    if event.purpose != "OPERATION" or item.processing_status != "CONFIRMED":
        resolve_admin_notification(db, notification_type=FOUND_ITEM_REGISTRATION_REQUIRED, related_type="DETECTED_OBJECT", related_id=item.id)
        resolve_admin_notification(db, notification_type=WASTE_COLLECTION_REQUIRED, related_type="DETECTED_OBJECT", related_id=item.id)
        if event is not None:
            sync_detection_review_notification(db, event)
        return

    group = _effective_group(item)
    has_found_item = bool(db.scalar(select(FoundItem.id).where(FoundItem.detected_object_id == item.id).limit(1)))
    has_collection = _has_waste_collection_completed(db, item.id)

    if group == PERSONAL_ITEM_GROUP and not has_found_item:
        create_admin_notification_once(db, notification_type=FOUND_ITEM_REGISTRATION_REQUIRED, related_type="DETECTED_OBJECT", related_id=item.id)
    else:
        resolve_admin_notification(db, notification_type=FOUND_ITEM_REGISTRATION_REQUIRED, related_type="DETECTED_OBJECT", related_id=item.id)

    if group == WASTE_GROUP and not has_collection:
        create_admin_notification_once(db, notification_type=WASTE_COLLECTION_REQUIRED, related_type="DETECTED_OBJECT", related_id=item.id)
    else:
        resolve_admin_notification(db, notification_type=WASTE_COLLECTION_REQUIRED, related_type="DETECTED_OBJECT", related_id=item.id)

    sync_detection_review_notification(db, event)


def sync_citizen_report_notification(db: Session, report: CitizenReport) -> None:
    db.flush()
    if report.status in {"PENDING", "UNDER_REVIEW"}:
        create_admin_notification_once(
            db,
            notification_type=CITIZEN_REPORT_REVIEW_REQUIRED,
            related_type="CITIZEN_REPORT",
            related_id=report.id,
        )
    else:
        resolve_admin_notification(
            db,
            notification_type=CITIZEN_REPORT_REVIEW_REQUIRED,
            related_type="CITIZEN_REPORT",
            related_id=report.id,
        )


def sync_ownership_claim_notifications(db: Session, claim: OwnershipClaim) -> None:
    db.flush()
    if claim.status == "PENDING":
        create_admin_notification_once(
            db,
            notification_type=OWNERSHIP_CLAIM_REVIEW_REQUIRED,
            related_type="OWNERSHIP_CLAIM",
            related_id=claim.id,
        )
    else:
        resolve_admin_notification(
            db,
            notification_type=OWNERSHIP_CLAIM_REVIEW_REQUIRED,
            related_type="OWNERSHIP_CLAIM",
            related_id=claim.id,
        )

    if claim.status == "APPROVED":
        create_admin_notification_once(
            db,
            notification_type=OWNERSHIP_RETURN_REQUIRED,
            related_type="OWNERSHIP_CLAIM",
            related_id=claim.id,
        )
    elif claim.status == "RETURNED":
        resolve_admin_notification(
            db,
            notification_type=OWNERSHIP_RETURN_REQUIRED,
            related_type="OWNERSHIP_CLAIM",
            related_id=claim.id,
        )
    elif claim.status == "REJECTED":
        resolve_admin_notification(
            db,
            notification_type=OWNERSHIP_RETURN_REQUIRED,
            related_type="OWNERSHIP_CLAIM",
            related_id=claim.id,
        )


def _base_list_query(admin_user_id: int) -> Select[tuple[AdminNotification, datetime | None]]:
    return (
        select(AdminNotification, AdminNotificationRead.read_at)
        .outerjoin(
            AdminNotificationRead,
            and_(
                AdminNotificationRead.admin_notification_id == AdminNotification.id,
                AdminNotificationRead.admin_user_id == admin_user_id,
            ),
        )
    )


def _apply_filter(statement: Select, notification_filter: AdminNotificationFilter, admin_user_id: int) -> Select:
    if notification_filter == "unread":
        statement = statement.where(AdminNotificationRead.admin_notification_id.is_(None))
    elif notification_filter == "actionable":
        statement = statement.where(AdminNotification.resolved_at.is_(None))
    elif notification_filter == "resolved":
        statement = statement.where(AdminNotification.resolved_at.is_not(None))
    return statement


def _count_query(db: Session, statement: Select) -> int:
    return int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)


def list_admin_notifications(
    db: Session,
    *,
    admin_user_id: int,
    notification_filter: AdminNotificationFilter,
    skip: int,
    limit: int,
) -> dict:
    statement = _apply_filter(_base_list_query(admin_user_id), notification_filter, admin_user_id)
    total = _count_query(db, statement)
    rows = db.execute(statement.order_by(AdminNotification.created_at.desc(), AdminNotification.id.desc()).offset(skip).limit(limit)).all()

    unread_count = _count_query(db, _apply_filter(_base_list_query(admin_user_id), "unread", admin_user_id))
    actionable_count = _count_query(db, _apply_filter(_base_list_query(admin_user_id), "actionable", admin_user_id))

    return {
        "items": [
            {
                "id": notification.id,
                "notification_type": notification.notification_type,
                "title": notification.title,
                "message": notification.message,
                "related_type": notification.related_type,
                "related_id": notification.related_id,
                "read_at": read_at,
                "resolved_at": notification.resolved_at,
                "created_at": notification.created_at,
                "is_read": read_at is not None,
                "is_actionable": notification.resolved_at is None,
            }
            for notification, read_at in rows
        ],
        "total": total,
        "unread_count": unread_count,
        "actionable_count": actionable_count,
    }


def get_admin_notification_item(db: Session, *, notification_id: int, admin_user_id: int) -> dict | None:
    rows = db.execute(
        _base_list_query(admin_user_id).where(AdminNotification.id == notification_id)
    ).all()
    if not rows:
        return None
    notification, read_at = rows[0]
    return {
        "id": notification.id,
        "notification_type": notification.notification_type,
        "title": notification.title,
        "message": notification.message,
        "related_type": notification.related_type,
        "related_id": notification.related_id,
        "read_at": read_at,
        "resolved_at": notification.resolved_at,
        "created_at": notification.created_at,
        "is_read": read_at is not None,
        "is_actionable": notification.resolved_at is None,
    }


def mark_admin_notification_read(db: Session, *, notification_id: int, admin_user_id: int) -> dict | None:
    exists = db.scalar(select(AdminNotification.id).where(AdminNotification.id == notification_id))
    if exists is None:
        return None
    now = utc_now()
    values = {"admin_notification_id": notification_id, "admin_user_id": admin_user_id, "read_at": now}
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = postgres_insert(AdminNotificationRead).values(**values).on_conflict_do_nothing(
            index_elements=["admin_notification_id", "admin_user_id"]
        )
        db.execute(statement)
    elif dialect == "sqlite":
        statement = sqlite_insert(AdminNotificationRead).values(**values).on_conflict_do_nothing(
            index_elements=["admin_notification_id", "admin_user_id"]
        )
        db.execute(statement)
    else:
        read_exists = db.scalar(select(AdminNotificationRead.admin_notification_id).where(
            AdminNotificationRead.admin_notification_id == notification_id,
            AdminNotificationRead.admin_user_id == admin_user_id,
        ))
        if read_exists is None:
            db.add(AdminNotificationRead(**values))
    db.commit()
    return get_admin_notification_item(db, notification_id=notification_id, admin_user_id=admin_user_id)


def mark_all_admin_notifications_read(db: Session, *, admin_user_id: int) -> int:
    unread_rows = db.scalars(
        select(AdminNotification.id)
        .outerjoin(
            AdminNotificationRead,
            and_(
                AdminNotificationRead.admin_notification_id == AdminNotification.id,
                AdminNotificationRead.admin_user_id == admin_user_id,
            ),
        )
        .where(AdminNotificationRead.admin_notification_id.is_(None))
    ).all()
    for notification_id in unread_rows:
        values = {"admin_notification_id": notification_id, "admin_user_id": admin_user_id, "read_at": utc_now()}
        dialect = db.get_bind().dialect.name
        if dialect == "postgresql":
            db.execute(postgres_insert(AdminNotificationRead).values(**values).on_conflict_do_nothing(
                index_elements=["admin_notification_id", "admin_user_id"]
            ))
        elif dialect == "sqlite":
            db.execute(sqlite_insert(AdminNotificationRead).values(**values).on_conflict_do_nothing(
                index_elements=["admin_notification_id", "admin_user_id"]
            ))
        else:
            db.add(AdminNotificationRead(**values))
    db.commit()
    return len(unread_rows)


def operation_detection_has_pending_objects() -> Select:
    return select(DetectedObject.id).where(
        DetectedObject.detection_event_id == DetectionEvent.id,
        DetectedObject.processing_status == "PENDING",
    ).exists()


def backfill_admin_notification_sql_fragments() -> tuple[str, ...]:
    """Names are kept in code so tests can assert the migration stays aligned."""
    return (
        OPERATION_DETECTION_REVIEW_REQUIRED,
        FOUND_ITEM_REGISTRATION_REQUIRED,
        WASTE_COLLECTION_REQUIRED,
        CITIZEN_REPORT_REVIEW_REQUIRED,
        OWNERSHIP_CLAIM_REVIEW_REQUIRED,
        OWNERSHIP_RETURN_REQUIRED,
    )
