from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Path, Query, UploadFile, status

from app.schemas.admin import DetectedObjectUpdateRequest
from app.schemas.common import MessageResponse
from app.schemas.found_item import FoundItemUpdateRequest
from app.schemas.ownership_claim import OwnershipClaimUpdateRequest

router = APIRouter(prefix="/api/admin", tags=["admin"])


def not_implemented() -> None:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")


@router.post("/detections/images", response_model=MessageResponse, summary="이미지 탐지 요청")
def detect_image(file: Annotated[UploadFile, File(description="탐지할 이미지")]) -> None:
    # TODO: Add admin authorization dependency and detection service integration.
    not_implemented()


@router.post("/detections/videos", response_model=MessageResponse, summary="영상 탐지 요청")
def detect_video(file: Annotated[UploadFile, File(description="탐지할 영상")]) -> None:
    # TODO: Add admin authorization dependency and detection service integration.
    not_implemented()


@router.get("/detections", response_model=MessageResponse, summary="탐지 작업 목록 조회")
def list_detections(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> None:
    # TODO: Add admin authorization dependency.
    not_implemented()


@router.patch("/detected-objects/{id}", response_model=MessageResponse, summary="탐지 객체 수정")
def update_detected_object(
    id: Annotated[int, Path(ge=1)], request: DetectedObjectUpdateRequest
) -> None:
    # TODO: Add admin authorization dependency.
    not_implemented()


@router.patch("/found-items/{id}", response_model=MessageResponse, summary="발견물 수정")
def update_found_item(
    id: Annotated[int, Path(ge=1)], request: FoundItemUpdateRequest
) -> None:
    # TODO: Add admin authorization dependency.
    not_implemented()


@router.get("/ownership-claims", response_model=MessageResponse, summary="소유권 확인 요청 목록 조회")
def list_ownership_claims(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> None:
    # TODO: Add admin authorization dependency.
    not_implemented()


@router.patch(
    "/ownership-claims/{id}", response_model=MessageResponse, summary="소유권 확인 요청 처리"
)
def update_ownership_claim(
    id: Annotated[int, Path(ge=1)], request: OwnershipClaimUpdateRequest
) -> None:
    # TODO: Add admin authorization dependency.
    not_implemented()
