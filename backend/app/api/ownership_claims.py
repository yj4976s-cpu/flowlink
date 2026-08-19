from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import PositiveInt
from sqlalchemy.orm import Session

from app.core.auth import require_user
from app.db.session import get_db
from app.models import User
from app.schemas.ownership_claim import OwnershipClaimCreateRequest, OwnershipClaimResponse
from app.services.ownership import create_claim_for_user, list_claim_activity_for_user, list_claim_progress_for_user, list_claims_for_user

router = APIRouter(prefix="/api/ownership-claims", tags=["ownership-claims"])


@router.get("/me/activity", response_model=list[OwnershipClaimResponse], summary="신고별 소유권 요청 활동 일괄 조회")
def list_my_ownership_claim_activity(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    lost_report_ids: Annotated[list[PositiveInt], Query(min_length=1, max_length=20)],
) -> list[OwnershipClaimResponse]:
    return list_claim_activity_for_user(db, current_user=current_user, lost_report_ids=lost_report_ids)


@router.get("/me/progress", response_model=list[OwnershipClaimResponse], summary="신고별 대표 소유권 요청 일괄 조회")
def list_my_ownership_claim_progress(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    lost_report_ids: Annotated[list[PositiveInt], Query(min_length=1, max_length=20)],
) -> list[OwnershipClaimResponse]:
    return list_claim_progress_for_user(db, current_user=current_user, lost_report_ids=lost_report_ids)


@router.get("/me", response_model=list[OwnershipClaimResponse], summary="내 소유권 확인 요청 목록 조회")
def list_my_ownership_claims(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[OwnershipClaimResponse]:
    return list_claims_for_user(
        db,
        current_user=current_user,
        skip=skip,
        limit=limit,
    )


@router.post("", response_model=OwnershipClaimResponse, status_code=201, summary="소유권 확인 요청 등록")
def create_ownership_claim(
    request: OwnershipClaimCreateRequest,
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OwnershipClaimResponse:
    return create_claim_for_user(db, current_user=current_user, request=request)
