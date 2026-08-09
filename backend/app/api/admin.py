from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.db.session import get_db
from app.models import User
from app.repositories.user_flow import get_ownership_claim_by_id, list_ownership_claims
from app.schemas.admin import AdminOwnershipClaimResponse, DetectedObjectUpdateRequest
from app.schemas.common import MessageResponse
from app.schemas.found_item import FoundItemUpdateRequest
from app.schemas.ownership_claim import OwnershipClaimUpdateRequest
from app.services.mappers import admin_ownership_claim_response
from app.services.ownership import review_ownership_claim

router = APIRouter(prefix="/api/admin", tags=["admin"])


def not_implemented() -> None:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")


@router.post("/detections/images", response_model=MessageResponse, summary="이미지 탐지 요청")
def detect_image(
    current_admin: Annotated[User, Depends(require_admin)],
    file: Annotated[UploadFile, File(description="탐지할 이미지")],
) -> None:
    not_implemented()


@router.post("/detections/videos", response_model=MessageResponse, summary="영상 탐지 요청")
def detect_video(
    current_admin: Annotated[User, Depends(require_admin)],
    file: Annotated[UploadFile, File(description="탐지할 영상")],
) -> None:
    not_implemented()


@router.get("/detections", response_model=MessageResponse, summary="탐지 작업 목록 조회")
def list_detections(
    current_admin: Annotated[User, Depends(require_admin)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> None:
    not_implemented()


@router.patch("/detected-objects/{id}", response_model=MessageResponse, summary="탐지 객체 수정")
def update_detected_object(
    current_admin: Annotated[User, Depends(require_admin)],
    id: Annotated[int, Path(ge=1)],
    request: DetectedObjectUpdateRequest,
) -> None:
    not_implemented()


@router.patch("/found-items/{id}", response_model=MessageResponse, summary="발견물 수정")
def update_found_item(
    current_admin: Annotated[User, Depends(require_admin)],
    id: Annotated[int, Path(ge=1)],
    request: FoundItemUpdateRequest,
) -> None:
    not_implemented()


@router.get("/ownership-claims", response_model=list[AdminOwnershipClaimResponse], summary="소유권 확인 요청 목록 조회")
def list_admin_ownership_claims(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[AdminOwnershipClaimResponse]:
    claims = list_ownership_claims(db, skip=skip, limit=limit)
    return [admin_ownership_claim_response(claim) for claim in claims]


@router.patch(
    "/ownership-claims/{id}", response_model=AdminOwnershipClaimResponse, summary="소유권 확인 요청 처리"
)
def update_ownership_claim(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, Path(ge=1)],
    request: OwnershipClaimUpdateRequest,
) -> AdminOwnershipClaimResponse:
    review_ownership_claim(db, current_admin=current_admin, claim_id=id, request=request)
    claim = get_ownership_claim_by_id(db, id)
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ownership claim not found")
    return admin_ownership_claim_response(claim)
