from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import to_utc, utc_now
from app.models import LostReport, User
from app.repositories.user_flow import (
    add_lost_report,
    clean_optional_text,
    get_active_personal_object_class,
)
from app.schemas.lost_report import LostReportCreateRequest, LostReportResponse
from app.services.mappers import lost_report_response
from app.services.matching import create_match_candidates_for_lost_report


def create_lost_report_for_user(
    db: Session,
    *,
    current_user: User,
    request: LostReportCreateRequest,
    image_url: str | None = None,
) -> LostReportResponse:
    object_class = get_active_personal_object_class(db, request.item_category)
    if object_class is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid personal item category")

    description = clean_optional_text(request.description)
    area_name = clean_optional_text(request.lost_location)
    if description is None or area_name is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Description and location are required")

    try:
        lost_from = to_utc(request.lost_at)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="lost_at must include timezone information",
        ) from exc
    if lost_from > utc_now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lost time cannot be in the future")

    now = utc_now()
    lost_report = LostReport(
        user_id=current_user.id,
        object_class_id=object_class.id,
        color=clean_optional_text(request.color),
        description=description,
        area_name=area_name,
        lost_from=lost_from,
        image_url=image_url,
        status="OPEN",
        created_at=now,
        updated_at=now,
    )
    try:
        add_lost_report(db, lost_report)
        lost_report.object_class = object_class
        create_match_candidates_for_lost_report(db, lost_report)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Could not create lost report") from exc

    db.refresh(lost_report)
    lost_report.object_class = object_class
    return lost_report_response(lost_report)


def can_view_lost_report(user: User, lost_report: LostReport) -> bool:
    return user.role == "ADMIN" or lost_report.user_id == user.id
