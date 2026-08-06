from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status

from app.schemas.common import MessageResponse

router = APIRouter(prefix="/api/found-items", tags=["found-items"])


def not_implemented() -> None:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")


@router.get("", response_model=MessageResponse, summary="발견물 목록 조회")
def list_found_items(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> None:
    not_implemented()


@router.get("/{id}", response_model=MessageResponse, summary="발견물 상세 조회")
def get_found_item(id: Annotated[int, Path(ge=1)]) -> None:
    not_implemented()
