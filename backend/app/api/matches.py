from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.common import MessageResponse

router = APIRouter(prefix="/api/matches", tags=["matches"])


@router.get("/me", response_model=MessageResponse, summary="내 매칭 목록 조회")
def list_my_matches(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> None:
    # TODO: Add JWT authentication dependency.
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")
