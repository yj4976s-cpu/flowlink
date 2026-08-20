from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path as ApiPath, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.auth import get_optional_current_user, require_user
from app.core.config import BACKEND_DIR, get_settings
from app.db.session import get_db
from app.models import User
from app.repositories.user_flow import get_active_personal_object_class
from app.schemas.citizen_report import CitizenReportResponse, CitizenReportUpdateRequest, CitizenSightingResponse
from app.services.citizen_reports import add_sighting, cancel_report, create_report, list_mine, list_public, update_report, visible_response
from app.services.image_uploads import remove_public_image, save_public_image

router = APIRouter(prefix="/api/citizen-reports", tags=["citizen-reports"])


def upload_root() -> Path:
    configured = Path(get_settings().UPLOAD_DIR)
    return configured if configured.is_absolute() else BACKEND_DIR / configured


@router.get("", response_model=list[CitizenReportResponse])
def get_public_reports(current_user: Annotated[User | None, Depends(get_optional_current_user)], db: Annotated[Session, Depends(get_db)], skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    return list_public(db, user_id=current_user.id if current_user else None, skip=skip, limit=limit)


@router.get("/mine", response_model=list[CitizenReportResponse])
def get_my_reports(current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)], skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    return list_mine(db, current_user.id, skip=skip, limit=limit)


@router.post("", response_model=CitizenReportResponse, status_code=201)
async def post_report(
    current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)],
    object_class: Annotated[str, Form()], description: Annotated[str, Form(min_length=5, max_length=1000)],
    area_name: Annotated[str, Form(min_length=1, max_length=100)], found_at: Annotated[datetime, Form()],
    color: Annotated[str | None, Form()] = None,
    image: Annotated[UploadFile | None, File()] = None,
):
    category = get_active_personal_object_class(db, object_class)
    if category is None:
        raise HTTPException(status_code=422, detail="Invalid personal item category")
    root = upload_root()
    image_url = await save_public_image(image, root)
    try:
        return create_report(db, user=current_user, object_class=category, color=color, description=description, image_url=image_url, area_name=area_name, found_at=found_at)
    except Exception:
        remove_public_image(image_url, root)
        raise


@router.get("/{id}", response_model=CitizenReportResponse)
def get_report(id: Annotated[int, ApiPath(ge=1)], current_user: Annotated[User | None, Depends(get_optional_current_user)], db: Annotated[Session, Depends(get_db)]):
    return visible_response(db, id, current_user)


@router.patch("/{id}", response_model=CitizenReportResponse)
def patch_report(id: Annotated[int, ApiPath(ge=1)], request: CitizenReportUpdateRequest, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]):
    category = get_active_personal_object_class(db, request.object_class) if request.object_class else None
    if request.object_class and category is None:
        raise HTTPException(status_code=422, detail="지원하지 않는 물품 종류입니다.")
    return update_report(db, user=current_user, report_id=id, request=request, object_class=category)


@router.delete("/{id}", response_model=CitizenReportResponse)
def delete_report(id: Annotated[int, ApiPath(ge=1)], current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]):
    return cancel_report(db, user=current_user, report_id=id, upload_root=upload_root())


@router.post("/{id}/sightings", response_model=CitizenReportResponse, status_code=201)
async def post_sighting(
    id: Annotated[int, ApiPath(ge=1)], current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)],
    sighted_at: Annotated[datetime, Form()], location_name: Annotated[str, Form(min_length=1, max_length=100)],
    description: Annotated[str, Form(min_length=5, max_length=1000)], image: Annotated[UploadFile | None, File()] = None,
):
    root = upload_root()
    image_url = await save_public_image(image, root)
    try:
        return add_sighting(db, user=current_user, report_id=id, sighted_at=sighted_at, location_name=location_name, description=description, image_url=image_url)
    except Exception:
        remove_public_image(image_url, root)
        raise


@router.get("/{id}/sightings", response_model=list[CitizenSightingResponse])
def get_sightings(
    id: Annotated[int, ApiPath(ge=1)],
    current_user: Annotated[User | None, Depends(get_optional_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return visible_response(db, id, current_user).sightings
