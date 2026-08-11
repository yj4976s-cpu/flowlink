from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path as ApiPath, Query, UploadFile, status
from sqlalchemy.orm import Session
from pydantic import ValidationError
from fastapi.exceptions import RequestValidationError

from app.core.auth import get_current_user, require_user
from app.core.config import BACKEND_DIR, get_settings
from app.db.session import get_db
from app.models import User
from app.repositories.user_flow import get_lost_report_by_id, get_lost_report_for_user, list_lost_reports_for_user
from app.schemas.lost_report import LostReportCreateRequest, LostReportResponse
from app.services.lost_reports import can_view_lost_report, create_lost_report_for_user
from app.services.mappers import lost_report_response
from app.services.image_uploads import remove_public_image, save_public_image

router = APIRouter(prefix="/api/lost-reports", tags=["lost-reports"])


def upload_root() -> Path:
    configured = Path(get_settings().UPLOAD_DIR)
    return configured if configured.is_absolute() else BACKEND_DIR / configured


@router.post("", response_model=LostReportResponse, status_code=201, summary="분실 신고 등록")
async def create_lost_report(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    item_category: Annotated[str, Form(min_length=1, max_length=50)],
    description: Annotated[str, Form(min_length=1)],
    lost_location: Annotated[str, Form(min_length=1, max_length=100)],
    lost_at: Annotated[datetime, Form()],
    color: Annotated[str | None, Form(max_length=50)] = None,
    colors: Annotated[list[str] | None, Form()] = None,
    image: Annotated[UploadFile | None, File()] = None,
) -> LostReportResponse:
    try:
        request = LostReportCreateRequest(item_category=item_category, color=color, colors=colors or ([color] if color else []), description=description, lost_location=lost_location, lost_at=lost_at)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc
    root = upload_root()
    image_url = await save_public_image(image, root, folder="lost-reports")
    try:
        return create_lost_report_for_user(db, current_user=current_user, request=request, image_url=image_url)
    except Exception:
        remove_public_image(image_url, root)
        raise


@router.get("/me", response_model=list[LostReportResponse], summary="내 분실 신고 목록 조회")
def list_my_lost_reports(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[LostReportResponse]:
    reports = list_lost_reports_for_user(db, current_user.id, skip=skip, limit=limit)
    return [lost_report_response(report) for report in reports]


@router.get("/{id}", response_model=LostReportResponse, summary="분실 신고 상세 조회")
def get_lost_report(
    id: Annotated[int, ApiPath(ge=1)],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> LostReportResponse:
    report = get_lost_report_by_id(db, id) if current_user.role == "ADMIN" else get_lost_report_for_user(db, id, current_user.id)
    if report is None or not can_view_lost_report(current_user, report):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lost report not found")
    return lost_report_response(report)
