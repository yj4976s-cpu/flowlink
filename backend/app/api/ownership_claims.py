from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.ownership_claim import OwnershipClaimCreateRequest, OwnershipClaimResponse
from app.services.ownership import create_claim_for_user

router = APIRouter(prefix="/api/ownership-claims", tags=["ownership-claims"])


@router.post("", response_model=OwnershipClaimResponse, status_code=201, summary="소유권 확인 요청 등록")
def create_ownership_claim(
    request: OwnershipClaimCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OwnershipClaimResponse:
    return create_claim_for_user(db, current_user=current_user, request=request)
