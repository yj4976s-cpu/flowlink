from fastapi import APIRouter, HTTPException, status

from app.schemas.common import MessageResponse
from app.schemas.ownership_claim import OwnershipClaimCreateRequest

router = APIRouter(prefix="/api/ownership-claims", tags=["ownership-claims"])


@router.post("", response_model=MessageResponse, summary="소유권 확인 요청 등록")
def create_ownership_claim(request: OwnershipClaimCreateRequest) -> None:
    # TODO: Add JWT authentication dependency.
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")
