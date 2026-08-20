from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.security import utc_now
from app.models import CitizenReport, CitizenSighting, FoundItem, Notification, ObjectClass, ProcessingHistory, User
from app.schemas.citizen_report import (
    AdminCitizenReportResponse, AdminCitizenReportUpdateRequest, CitizenReportResponse,
    CitizenReportUpdateRequest, CitizenSightingResponse, LinkedFoundItemSummary,
    ResolveCitizenReportRequest,
)
from app.services.image_uploads import remove_public_image
from app.services.matching import create_match_candidates_for_found_item

PUBLIC_STATUSES = {"UNDER_REVIEW", "LINKED"}
logger = logging.getLogger(__name__)


def _query():
    return select(CitizenReport).options(
        joinedload(CitizenReport.object_class), joinedload(CitizenReport.user),
        joinedload(CitizenReport.linked_found_item), selectinload(CitizenReport.sightings),
    ).execution_options(populate_existing=True)


def _clean(value: str | None) -> str | None:
    normalized = value.strip() if value is not None else None
    return normalized or None


def _response(report: CitizenReport, *, private: bool = False, admin: bool = False):
    common = dict(
        id=report.id, item_category=report.object_class.code, item_category_name=report.object_class.name_ko,
        color=report.color, description=report.description, image_url=report.image_url,
        area_name=report.area_name, latitude=report.latitude if private else None, longitude=report.longitude if private else None,
        found_at=report.found_at, status=report.status, sighting_count=len(report.sightings),
        sightings=[CitizenSightingResponse(id=item.id, sighted_at=item.sighted_at, location_name=item.location_name,
            description=item.description, image_url=item.image_url, created_at=item.created_at) for item in report.sightings],
        linked_found_item=LinkedFoundItemSummary(id=report.linked_found_item.id, status=report.linked_found_item.status) if report.linked_found_item else None,
        created_at=report.created_at, updated_at=report.updated_at,
    )
    if admin:
        return AdminCitizenReportResponse(**common, user_id=report.user_id, user_nickname=report.user.nickname,
            reviewed_by=report.reviewed_by, reviewed_at=report.reviewed_at, rejection_reason=report.rejection_reason,
            admin_memo=report.admin_memo, linked_at=report.linked_at)
    return CitizenReportResponse(**common)


def list_public(db: Session, *, user_id: int | None, skip: int, limit: int) -> list[CitizenReportResponse]:
    visibility = CitizenReport.status.in_(PUBLIC_STATUSES)
    if user_id is not None:
        visibility = or_(visibility, and_(CitizenReport.user_id == user_id, CitizenReport.status == "PENDING"))
    rows = db.scalars(_query().where(visibility).order_by(CitizenReport.found_at.desc()).offset(skip).limit(limit)).all()
    return [_response(row, private=user_id is not None and row.user_id == user_id) for row in rows]


def list_mine(db: Session, user_id: int, *, skip: int, limit: int) -> list[CitizenReportResponse]:
    rows = db.scalars(_query().where(CitizenReport.user_id == user_id, CitizenReport.status != "CANCELLED").order_by(CitizenReport.created_at.desc()).offset(skip).limit(limit)).all()
    return [_response(row, private=True) for row in rows]


def list_admin(db: Session, *, report_status: str | None, skip: int, limit: int) -> list[AdminCitizenReportResponse]:
    statement = _query().where(CitizenReport.status != "CANCELLED")
    if report_status:
        statement = statement.where(CitizenReport.status == report_status)
    rows = db.scalars(statement.order_by(CitizenReport.created_at.desc()).offset(skip).limit(limit)).all()
    return [_response(row, private=True, admin=True) for row in rows]


def get_report(db: Session, report_id: int) -> CitizenReport | None:
    return db.scalar(_query().where(CitizenReport.id == report_id))


def admin_response(db: Session, report_id: int) -> AdminCitizenReportResponse:
    report = get_report(db, report_id)
    if report is None or report.status == "CANCELLED":
        raise HTTPException(status_code=404, detail="Citizen report not found")
    return _response(report, private=True, admin=True)


def visible_response(db: Session, report_id: int, user: User | None) -> CitizenReportResponse:
    report = get_report(db, report_id)
    if report is None or report.status == "CANCELLED" or (report.status not in PUBLIC_STATUSES and (user is None or (user.role != "ADMIN" and user.id != report.user_id))):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Citizen report not found")
    return _response(report, private=user is not None and (user.role == "ADMIN" or user.id == report.user_id))


def create_report(db: Session, *, user: User, object_class: ObjectClass, color: str | None, description: str,
                  image_url: str | None, area_name: str, found_at: datetime) -> CitizenReportResponse:
    now = utc_now()
    report = CitizenReport(user_id=user.id, object_class_id=object_class.id, color=_clean(color),
        description=description.strip(), image_url=image_url, area_name=area_name.strip(), found_at=found_at,
        status="PENDING", created_at=now, updated_at=now)
    db.add(report); db.commit(); db.refresh(report)
    return visible_response(db, report.id, user)


def update_report(db: Session, *, user: User, report_id: int, request: CitizenReportUpdateRequest, object_class: ObjectClass | None) -> CitizenReportResponse:
    report = get_report(db, report_id)
    if report is None or report.user_id != user.id:
        raise HTTPException(status_code=404, detail="Citizen report not found")
    if report.status != "PENDING":
        raise HTTPException(status_code=409, detail="Only pending reports can be edited")
    values = request.model_dump(exclude_unset=True, exclude={"object_class"})
    for key, value in values.items(): setattr(report, key, _clean(value) if isinstance(value, str) else value)
    if object_class is not None: report.object_class_id = object_class.id
    report.updated_at = utc_now(); db.commit()
    return visible_response(db, report.id, user)


def cancel_report(db: Session, *, user: User, report_id: int, upload_root: Path) -> CitizenReportResponse:
    report = get_report(db, report_id)
    if report is None or report.user_id != user.id:
        raise HTTPException(status_code=404, detail="Citizen report not found")
    if report.status not in {"PENDING", "UNDER_REVIEW"}:
        raise HTTPException(status_code=409, detail="Report cannot be cancelled")
    image_url = report.image_url
    report.status = "CANCELLED"; report.image_url = None; report.updated_at = utc_now()
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    if image_url:
        try:
            remove_public_image(image_url, upload_root)
        except Exception:
            logger.exception("Failed to remove cancelled citizen report image", extra={"citizen_report_id": report.id})
    db.refresh(report)
    return _response(report, private=True)


def add_sighting(db: Session, *, user: User, report_id: int, sighted_at: datetime, location_name: str, description: str, image_url: str | None) -> CitizenReportResponse:
    report = get_report(db, report_id)
    if report is None or report.status not in PUBLIC_STATUSES:
        raise HTTPException(status_code=404, detail="Citizen report not found")
    db.add(CitizenSighting(citizen_report_id=report.id, user_id=user.id, sighted_at=sighted_at,
        location_name=location_name.strip(), description=description.strip(), image_url=image_url, created_at=utc_now()))
    db.commit()
    return visible_response(db, report.id, user)


def review_report(db: Session, *, admin: User, report_id: int, request: AdminCitizenReportUpdateRequest) -> AdminCitizenReportResponse:
    report = get_report(db, report_id)
    if report is None or report.status == "CANCELLED": raise HTTPException(status_code=404, detail="Citizen report not found")
    if report.status not in {"PENDING", "UNDER_REVIEW"}: raise HTTPException(status_code=409, detail="Report cannot be reviewed")
    if request.status == "REJECTED" and not _clean(request.rejection_reason): raise HTTPException(status_code=422, detail="Rejection reason is required")
    previous = report.status; now = utc_now(); report.status = request.status; report.reviewed_by = admin.id; report.reviewed_at = now
    report.rejection_reason = _clean(request.rejection_reason); report.admin_memo = _clean(request.admin_memo); report.updated_at = now
    db.add(ProcessingHistory(actor_user_id=admin.id, entity_type="CITIZEN_REPORT", entity_id=report.id,
        action_type="CITIZEN_REPORT_REVIEWED", previous_status=previous, new_status=report.status, note=report.admin_memo, created_at=now))
    db.add(Notification(user_id=report.user_id, notification_type="CITIZEN_REPORT_STATUS", title="시민 제보 상태가 변경되었습니다",
        message="등록한 발견 제보의 검토 상태를 확인해주세요.", related_type="CITIZEN_REPORT", related_id=report.id, created_at=now))
    db.commit(); return _response(get_report(db, report.id), private=True, admin=True)


def resolve_report(db: Session, *, admin: User, report_id: int, request: ResolveCitizenReportRequest, object_class: ObjectClass | None = None) -> AdminCitizenReportResponse:
    report = get_report(db, report_id)
    if report is None or report.status == "CANCELLED": raise HTTPException(status_code=404, detail="Citizen report not found")
    if report.status not in {"PENDING", "UNDER_REVIEW"}: raise HTTPException(status_code=409, detail="Report cannot be linked")
    now = utc_now()
    try:
        if request.mode == "LINK_EXISTING":
            if request.found_item_id is None: raise HTTPException(status_code=422, detail="found_item_id is required")
            found_item = db.get(FoundItem, request.found_item_id)
            if found_item is None: raise HTTPException(status_code=404, detail="Found item not found")
        else:
            if request.found_item is None or object_class is None: raise HTTPException(status_code=422, detail="found_item is required")
            value = request.found_item
            found_item = FoundItem(object_class_id=object_class.id, registered_by=admin.id, source_type="CITIZEN",
                color=_clean(value.color), public_description=_clean(value.public_description), private_features=_clean(value.private_features),
                area_name=value.area_name.strip(), latitude=value.latitude, longitude=value.longitude, found_at=value.found_at,
                status="AVAILABLE", storage_location=_clean(value.storage_location), is_public=True, created_at=now, updated_at=now)
            db.add(found_item); db.flush(); create_match_candidates_for_found_item(db, found_item)
        previous = report.status; report.status = "LINKED"; report.linked_found_item_id = found_item.id; report.linked_at = now
        report.reviewed_by = admin.id; report.reviewed_at = now; report.updated_at = now
        db.add(ProcessingHistory(actor_user_id=admin.id, entity_type="CITIZEN_REPORT", entity_id=report.id,
            action_type="CITIZEN_REPORT_LINKED", previous_status=previous, new_status="LINKED", note=None, created_at=now))
        db.add(Notification(user_id=report.user_id, notification_type="CITIZEN_REPORT_STATUS", title="시민 제보가 공식 발견물로 연결되었습니다",
            message="등록한 제보가 공식 발견물로 확인되었습니다.", related_type="CITIZEN_REPORT", related_id=report.id, created_at=now))
        db.commit()
    except Exception:
        db.rollback(); raise
    return _response(get_report(db, report.id), private=True, admin=True)
