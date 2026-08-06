from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status

from app.schemas.common import MessageResponse
from app.schemas.lost_report import LostReportCreateRequest

router = APIRouter(prefix="/api/lost-reports", tags=["lost-reports"])


def not_implemented() -> None:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")


@router.post("", response_model=MessageResponse, summary="분실 신고 등록")
def create_lost_report(request: LostReportCreateRequest) -> None:
    # TODO: Add JWT authentication dependency.
    not_implemented()


@router.get("/me", response_model=MessageResponse, summary="내 분실 신고 목록 조회")
def list_my_lost_reports(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> None:
    # TODO: Add JWT authentication dependency.
    not_implemented()


@router.get("/{id}", response_model=MessageResponse, summary="분실 신고 상세 조회")
def get_lost_report(id: Annotated[int, Path(ge=1)]) -> None:
    # TODO: Add JWT authentication dependency.
    not_implemented()
