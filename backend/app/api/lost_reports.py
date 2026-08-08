from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models import User
from app.repositories.user_flow import get_lost_report_by_id, get_lost_report_for_user, list_lost_reports_for_user
from app.schemas.lost_report import LostReportCreateRequest, LostReportResponse
from app.services.lost_reports import can_view_lost_report, create_lost_report_for_user
from app.services.mappers import lost_report_response

router = APIRouter(prefix="/api/lost-reports", tags=["lost-reports"])


@router.post("", response_model=LostReportResponse, status_code=201, summary="분실 신고 등록")
def create_lost_report(
    request: LostReportCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> LostReportResponse:
    return create_lost_report_for_user(db, current_user=current_user, request=request)


@router.get("/me", response_model=list[LostReportResponse], summary="내 분실 신고 목록 조회")
def list_my_lost_reports(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[LostReportResponse]:
    reports = list_lost_reports_for_user(db, current_user.id, skip=skip, limit=limit)
    return [lost_report_response(report) for report in reports]


@router.get("/{id}", response_model=LostReportResponse, summary="분실 신고 상세 조회")
def get_lost_report(
    id: Annotated[int, Path(ge=1)],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> LostReportResponse:
    report = get_lost_report_by_id(db, id) if current_user.role == "ADMIN" else get_lost_report_for_user(db, id, current_user.id)
    if report is None or not can_view_lost_report(current_user, report):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lost report not found")
    return lost_report_response(report)
