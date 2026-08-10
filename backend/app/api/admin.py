from datetime import UTC, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.security import utc_now
from app.db.session import get_db
from app.models import ProcessingHistory, User
from app.repositories.user_flow import (
    clean_optional_text,
    get_admin_dashboard_data,
    get_detected_object_by_id,
    get_found_item_by_id,
    get_object_class_by_code,
    get_ownership_claim_by_id,
    list_detection_events,
    list_ownership_claims,
    waste_collection_completed_ids,
)
from app.schemas.admin import AdminDashboardResponse, AdminDetectedObjectCollectionResponse, AdminDetectedObjectFoundItemResponse, AdminDetectionEventResponse, AdminOwnershipClaimResponse, DetectedObjectUpdateRequest
from app.schemas.citizen_report import AdminCitizenReportResponse, AdminCitizenReportUpdateRequest, ResolveCitizenReportRequest
from app.schemas.common import MessageResponse
from app.schemas.found_item import FoundItemUpdateRequest
from app.schemas.ownership_claim import OwnershipClaimUpdateRequest
from app.services.mappers import admin_ownership_claim_response
from app.services.ownership import review_ownership_claim
from app.services.citizen_reports import admin_response, list_admin as list_admin_citizen_reports, resolve_report, review_report
from app.services.admin_detection_actions import complete_waste_collection, create_ai_found_item, effective_group

router = APIRouter(prefix="/api/admin", tags=["admin"])
KST = ZoneInfo("Asia/Seoul")
FOUND_ITEM_STATUSES = {"DETECTED", "RECOVERED", "AVAILABLE", "CLAIM_PENDING", "RETURNED", "DISPOSED"}


def detected_object_payload(item, *, collected_ids: set[int] | None = None) -> dict:
    group = effective_group(item)
    return {
        "id": item.id,
        "object_class": item.object_class.code,
        "object_class_name": item.object_class.name_ko,
        "final_class_code": item.final_class_code,
        "confidence": item.confidence,
        "bbox_x": item.bbox_x,
        "bbox_y": item.bbox_y,
        "bbox_width": item.bbox_width,
        "bbox_height": item.bbox_height,
        "cropped_image_url": item.cropped_image_url,
        "detected_at": item.detected_at,
        "processing_status": item.processing_status,
        "admin_memo": item.admin_memo,
        "track_id": item.track_id,
        "first_seen_ms": item.first_seen_ms,
        "last_seen_ms": item.last_seen_ms,
        "appearance_count": item.appearance_count,
        "follow_up_kind": "FOUND_ITEM" if group == "PERSONAL_ITEM" else "WASTE" if group == "WASTE" else "NONE",
        "found_item_id": item.found_item.id if item.found_item is not None else None,
        "waste_collection_completed": item.id in (collected_ids or set()),
    }


def detection_event_payload(event, *, collected_ids: set[int] | None = None) -> dict:
    return {
        "id": event.id,
        "source_type": event.source_type,
        "original_media_url": event.original_media_url,
        "result_media_url": event.result_media_url,
        "status": event.status,
        "captured_at": event.captured_at,
        "processing_started_at": event.processing_started_at,
        "processing_completed_at": event.processing_completed_at,
        "error_message": event.error_message,
        "camera_id": event.camera_id,
        "detected_objects": [detected_object_payload(item, collected_ids=collected_ids) for item in event.detected_objects],
    }


@router.get("/dashboard", response_model=AdminDashboardResponse, summary="관리자 오늘 운영 대시보드")
def get_admin_dashboard(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    period: Annotated[Literal["today", "7d", "all"], Query()] = "today",
) -> AdminDashboardResponse:
    now = utc_now()
    today_kst = now.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    since_kst = today_kst if period == "today" else today_kst - timedelta(days=6) if period == "7d" else None
    since = since_kst.astimezone(UTC) if since_kst is not None else None
    return AdminDashboardResponse.model_validate(get_admin_dashboard_data(db, since=since, period=period, now=now))


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


@router.get("/detections", response_model=list[AdminDetectionEventResponse], summary="탐지 작업 목록 조회")
def list_detections(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[AdminDetectionEventResponse]:
    events = list_detection_events(db, skip=skip, limit=limit)
    object_ids = [item.id for event in events for item in event.detected_objects]
    collected_ids = waste_collection_completed_ids(db, object_ids)
    return [AdminDetectionEventResponse.model_validate(detection_event_payload(event, collected_ids=collected_ids)) for event in events]


@router.post("/detected-objects/{id}/found-item", response_model=AdminDetectedObjectFoundItemResponse, status_code=status.HTTP_201_CREATED, summary="AI 탐지 객체를 공식 발견물로 등록")
def create_found_item_from_detection(
    current_admin: Annotated[User, Depends(require_admin)], db: Annotated[Session, Depends(get_db)], id: Annotated[int, Path(ge=1)],
) -> AdminDetectedObjectFoundItemResponse:
    found_item = create_ai_found_item(db, admin=current_admin, detected_object_id=id)
    return AdminDetectedObjectFoundItemResponse(detected_object_id=id, found_item_id=found_item.id, source_type="AI")


@router.post("/detected-objects/{id}/collect", response_model=AdminDetectedObjectCollectionResponse, summary="폐기물 탐지 객체 수거 완료")
def collect_detected_waste(
    current_admin: Annotated[User, Depends(require_admin)], db: Annotated[Session, Depends(get_db)], id: Annotated[int, Path(ge=1)],
) -> AdminDetectedObjectCollectionResponse:
    complete_waste_collection(db, admin=current_admin, detected_object_id=id)
    return AdminDetectedObjectCollectionResponse(detected_object_id=id)


@router.patch("/detected-objects/{id}", response_model=MessageResponse, summary="탐지 객체 수정")
def update_detected_object(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, Path(ge=1)],
    request: DetectedObjectUpdateRequest,
) -> MessageResponse:
    item = get_detected_object_by_id(db, id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detected object not found")
    previous_status = item.processing_status
    if request.final_class_code is not None:
        code = request.final_class_code.strip().upper()
        if get_object_class_by_code(db, code) is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid object class")
        item.final_class_code = code
    if request.processing_status is not None:
        item.processing_status = request.processing_status
    if request.admin_memo is not None:
        item.admin_memo = clean_optional_text(request.admin_memo)
    db.add(ProcessingHistory(actor_user_id=current_admin.id, entity_type="DETECTED_OBJECT", entity_id=item.id, action_type="DETECTED_OBJECT_REVIEWED", previous_status=previous_status, new_status=item.processing_status, note=item.admin_memo, created_at=utc_now()))
    db.commit()
    return MessageResponse(message="Detected object updated")


@router.patch("/found-items/{id}", response_model=MessageResponse, summary="발견물 수정")
def update_found_item(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, Path(ge=1)],
    request: FoundItemUpdateRequest,
) -> MessageResponse:
    item = get_found_item_by_id(db, id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Found item not found")
    previous_status = item.status
    if request.status is not None:
        next_status = request.status.strip().upper()
        if next_status not in FOUND_ITEM_STATUSES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid found item status")
        item.status = next_status
    if request.storage_location is not None:
        item.storage_location = clean_optional_text(request.storage_location)
    if request.admin_memo is not None:
        item.admin_memo = clean_optional_text(request.admin_memo)
    item.updated_at = utc_now()
    db.add(ProcessingHistory(actor_user_id=current_admin.id, entity_type="FOUND_ITEM", entity_id=item.id, action_type="FOUND_ITEM_UPDATED", previous_status=previous_status, new_status=item.status, note=item.admin_memo, created_at=item.updated_at))
    db.commit()
    return MessageResponse(message="Found item updated")


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


@router.get("/citizen-reports", response_model=list[AdminCitizenReportResponse], summary="시민 제보 관리 목록")
def list_citizen_reports(
    current_admin: Annotated[User, Depends(require_admin)], db: Annotated[Session, Depends(get_db)],
    report_status: Annotated[str | None, Query(alias="status")] = None,
    skip: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    return list_admin_citizen_reports(db, report_status=report_status, skip=skip, limit=limit)


@router.patch("/citizen-reports/{id}", response_model=AdminCitizenReportResponse, summary="시민 제보 검토")
def patch_citizen_report(
    id: Annotated[int, Path(ge=1)], request: AdminCitizenReportUpdateRequest,
    current_admin: Annotated[User, Depends(require_admin)], db: Annotated[Session, Depends(get_db)],
):
    return review_report(db, admin=current_admin, report_id=id, request=request)


@router.get("/citizen-reports/{id}", response_model=AdminCitizenReportResponse, summary="시민 제보 관리 상세")
def get_admin_citizen_report(
    id: Annotated[int, Path(ge=1)], current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return admin_response(db, id)


@router.post("/citizen-reports/{id}/resolve", response_model=AdminCitizenReportResponse, summary="시민 제보 공식 발견물 연결")
def resolve_citizen_report(
    id: Annotated[int, Path(ge=1)], request: ResolveCitizenReportRequest,
    current_admin: Annotated[User, Depends(require_admin)], db: Annotated[Session, Depends(get_db)],
):
    category = None
    if request.mode == "CREATE_FOUND_ITEM" and request.found_item is not None:
        category = get_object_class_by_code(db, request.found_item.object_class.strip().upper())
        if category is None or category.group_code != "PERSONAL_ITEM":
            raise HTTPException(status_code=422, detail="Invalid personal item category")
    return resolve_report(db, admin=current_admin, report_id=id, request=request, object_class=category)
