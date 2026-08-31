from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.config import Settings, get_settings
from app.core.security import utc_now
from app.db.session import get_db
from app.models import Camera, CommunityComment, CommunityPost, FoundItem, ProcessingHistory, User
from app.repositories.user_flow import (
    clean_optional_text,
    get_admin_dashboard_data,
    get_admin_ai_report_data,
    get_detected_object_by_id,
    get_found_item_by_id,
    has_other_active_ownership_claim,
    get_object_class_by_code,
    get_ownership_claim_by_id,
    list_detection_events,
    list_admin_found_items,
    list_ownership_claims,
    waste_collection_completed_ids,
)
from app.schemas.admin import AdminAiReportResponse, AdminCameraResponse, AdminCommunityPostListResponse, AdminDashboardResponse, AdminDetectedObjectCollectionResponse, AdminDetectedObjectFoundItemResponse, AdminDetectionEventResponse, AdminFoundItemListResponse, AdminMobileWasteRegistrationResponse, AdminModelComparisonResponse, AdminModelDeploymentHistoryResponse, AdminModelDeploymentRequest, AdminModelDeploymentRollbackRequest, AdminModelDeploymentStatusResponse, AdminModelDeploymentSwitchResponse, AdminOperationsBriefingResponse, AdminOperationsBriefingStatus, AdminOwnershipClaimResponse, AdminUserListResponse, DetectedObjectUpdateRequest
from app.schemas.citizen_report import AdminCitizenReportResponse, AdminCitizenReportUpdateRequest, ResolveCitizenReportRequest
from app.schemas.common import MessageResponse
from app.schemas.found_item import FoundItemUpdateRequest
from app.schemas.ownership_claim import OwnershipClaimUpdateRequest
from app.services.mappers import admin_ownership_claim_response
from app.services.ownership import review_ownership_claim
from app.services.citizen_reports import admin_response, list_admin as list_admin_citizen_reports, resolve_report, review_report
from app.services.admin_detection_actions import complete_waste_collection, create_ai_found_item, effective_group
from app.services.detection_inference import DetectionBBox, DetectionInferenceService, get_inference_service
from app.services.detections import DetectionModelUnavailableError, create_operation_detection_event, process_detection_event
from app.services.color_estimation import normalize_item_color
from app.services.matching import reconcile_match_candidates_for_found_item
from app.services.geocoding import GeocodingError, geocode_location
from app.services.found_item_images import representative_found_item_image_url
from app.services.mobile_waste import register_mobile_waste_candidate
from app.services.model_comparison import ModelComparisonDataError, load_model_comparison
from app.services.ai_inference_client import get_ai_inference_client
from app.services.model_deployment import activate_model, get_model_deployment_status, list_model_deployment_history, rollback_model
from app.services.admin_operations_briefing import create_admin_operations_briefing, get_admin_operations_briefing_status
from app.api.detections import IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES, WEBCAM_FRAME_MAX_BYTES, save_upload_file

router = APIRouter(prefix="/api/admin", tags=["admin"])
KST = ZoneInfo("Asia/Seoul")
FOUND_ITEM_STATUSES = {"DETECTED", "RECOVERED", "AVAILABLE", "CLAIM_PENDING", "RETURNED", "DISPOSED", "ARCHIVED"}


@router.get("/ai-report", response_model=AdminAiReportResponse, summary="AI 운영 탐지 품질 집계")
def get_admin_ai_report(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminAiReportResponse:
    return AdminAiReportResponse.model_validate(get_admin_ai_report_data(db))


@router.get("/ai-report/operations-briefing/status", response_model=AdminOperationsBriefingStatus, summary="운영 AI 브리핑 연결 상태")
def get_admin_operations_briefing_connection_status(
    current_admin: Annotated[User, Depends(require_admin)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AdminOperationsBriefingStatus:
    del current_admin
    return AdminOperationsBriefingStatus.model_validate(get_admin_operations_briefing_status(settings))


@router.post("/ai-report/operations-briefing", response_model=AdminOperationsBriefingResponse, summary="운영 AI 브리핑 수동 생성")
async def generate_admin_operations_briefing(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AdminOperationsBriefingResponse:
    del current_admin
    return AdminOperationsBriefingResponse.model_validate(await create_admin_operations_briefing(db, settings))


@router.get("/model-comparison", response_model=AdminModelComparisonResponse, summary="관리자 모델 비교 평가 결과")
def get_admin_model_comparison(
    current_admin: Annotated[User, Depends(require_admin)],
) -> AdminModelComparisonResponse:
    del current_admin
    try:
        return load_model_comparison()
    except ModelComparisonDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model comparison data is unavailable",
        ) from exc


@router.get("/model-deployment", response_model=AdminModelDeploymentStatusResponse, summary="관리자 모델 런타임 상태 조회")
def get_admin_model_deployment(
    current_admin: Annotated[User, Depends(require_admin)],
) -> AdminModelDeploymentStatusResponse:
    del current_admin
    return get_model_deployment_status(get_ai_inference_client())


@router.get("/model-deployment/history", response_model=AdminModelDeploymentHistoryResponse, summary="관리자 모델 전환 이력 조회")
def get_admin_model_deployment_history(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> AdminModelDeploymentHistoryResponse:
    del current_admin
    return AdminModelDeploymentHistoryResponse(events=list_model_deployment_history(db, limit=limit))


@router.post("/model-deployment/activate", response_model=AdminModelDeploymentSwitchResponse, summary="관리자 모델 활성화")
def activate_admin_model(
    request: AdminModelDeploymentRequest,
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminModelDeploymentSwitchResponse:
    return activate_model(
        db,
        admin=current_admin,
        ai_client=get_ai_inference_client(),
        model_id=request.model_id,
        expected_active_model_id=request.expected_active_model_id,
        request_id=request.request_id,
    )


@router.post("/model-deployment/rollback", response_model=AdminModelDeploymentSwitchResponse, summary="관리자 모델 롤백")
def rollback_admin_model(
    request: AdminModelDeploymentRollbackRequest,
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminModelDeploymentSwitchResponse:
    return rollback_model(
        db,
        admin=current_admin,
        ai_client=get_ai_inference_client(),
        expected_active_model_id=request.expected_active_model_id,
        request_id=request.request_id,
    )


def detected_object_payload(item, *, collected_ids: set[int] | None = None, operational: bool = True) -> dict:
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
        "ai_color": item.ai_color,
        "confirmed_color": item.confirmed_color,
        "detected_at": item.detected_at,
        "processing_status": item.processing_status,
        "admin_memo": item.admin_memo,
        "track_id": item.track_id,
        "first_seen_ms": item.first_seen_ms,
        "last_seen_ms": item.last_seen_ms,
        "appearance_count": item.appearance_count,
        "follow_up_kind": "FOUND_ITEM" if operational and group == "PERSONAL_ITEM" else "WASTE" if operational and group == "WASTE" else "NONE",
        "found_item_id": item.found_item.id if item.found_item is not None else None,
        "waste_collection_completed": item.id in (collected_ids or set()),
    }


def detection_event_payload(event, *, collected_ids: set[int] | None = None) -> dict:
    return {
        "id": event.id,
        "purpose": event.purpose,
        "source_type": event.source_type,
        "original_media_url": event.original_media_url,
        "result_media_url": event.result_media_url,
        "ai_model_id": event.ai_model_id,
        "status": event.status,
        "captured_at": event.captured_at,
        "processing_started_at": event.processing_started_at,
        "processing_completed_at": event.processing_completed_at,
        "error_message": event.error_message,
        "camera_id": event.camera_id,
        "detected_objects": [detected_object_payload(item, collected_ids=collected_ids, operational=event.purpose == "OPERATION") for item in event.detected_objects],
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


@router.get("/users", response_model=AdminUserListResponse, summary="관리자 사용자 현황 조회")
def list_admin_users(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str | None, Query(max_length=100)] = None,
    role: Annotated[Literal["USER", "ADMIN"] | None, Query()] = None,
    active: Annotated[bool | None, Query()] = None,
    include_deleted: Annotated[bool, Query()] = False,
) -> AdminUserListResponse:
    del current_admin
    now = utc_now()
    today_kst = now.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = today_kst.astimezone(UTC)
    seven_days_start = (today_kst - timedelta(days=6)).astimezone(UTC)
    trend_dates = [(today_kst.date() - timedelta(days=6 - index)) for index in range(7)]
    trend_counts = {date.isoformat(): 0 for date in trend_dates}
    for created_at in db.scalars(select(User.created_at).where(User.created_at >= seven_days_start)).all():
        date_key = created_at.astimezone(KST).date().isoformat()
        if date_key in trend_counts:
            trend_counts[date_key] += 1

    total_users = int(db.scalar(select(func.count(User.id))) or 0)
    deleted_users = int(db.scalar(select(func.count(User.id)).where(User.deleted_at.is_not(None))) or 0)
    active_users = int(db.scalar(select(func.count(User.id)).where(User.deleted_at.is_(None), User.active.is_(True))) or 0)
    inactive_users = int(db.scalar(select(func.count(User.id)).where(User.deleted_at.is_(None), User.active.is_(False))) or 0)
    admin_users = int(db.scalar(select(func.count(User.id)).where(User.deleted_at.is_(None), User.role == "ADMIN")) or 0)
    regular_users = int(db.scalar(select(func.count(User.id)).where(User.deleted_at.is_(None), User.role == "USER")) or 0)

    conditions = []
    if not include_deleted:
        conditions.append(User.deleted_at.is_(None))
    if q:
        pattern = f"%{q.strip()}%"
        conditions.append(or_(User.email.ilike(pattern), User.nickname.ilike(pattern)))
    if role:
        conditions.append(User.role == role)
    if active is not None:
        conditions.append(User.active.is_(active))

    filtered_total = int(db.scalar(select(func.count(User.id)).where(*conditions)) or 0)
    rows = db.scalars(
        select(User)
        .where(*conditions)
        .order_by(User.created_at.desc(), User.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return AdminUserListResponse.model_validate({
        "summary": {
            "total": total_users,
            "active": active_users,
            "inactive": inactive_users,
            "admins": admin_users,
            "users": regular_users,
            "deleted": deleted_users,
            "new_today": int(db.scalar(select(func.count(User.id)).where(User.created_at >= today_start)) or 0),
            "new_last_7_days": int(db.scalar(select(func.count(User.id)).where(User.created_at >= seven_days_start)) or 0),
        },
        "role_breakdown": [
            {"role": "ADMIN", "count": admin_users},
            {"role": "USER", "count": regular_users},
        ],
        "status_breakdown": [
            {"status": "ACTIVE", "count": active_users},
            {"status": "INACTIVE", "count": inactive_users},
            {"status": "DELETED", "count": deleted_users},
        ],
        "signup_trend": [{"date": date.isoformat(), "count": trend_counts[date.isoformat()]} for date in trend_dates],
        "users": [
            {
                "id": user.id,
                "email": user.email,
                "nickname": user.nickname,
                "role": user.role,
                "active": user.active,
                "created_at": user.created_at,
                "last_login_at": user.last_login_at,
                "deleted_at": user.deleted_at,
            }
            for user in rows
        ],
        "total": filtered_total,
    })


@router.get("/community-posts", response_model=AdminCommunityPostListResponse, summary="관리자 커뮤니티 게시글 현황 조회")
def list_admin_community_posts(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str | None, Query(max_length=100)] = None,
    category: Annotated[Literal["FIELD_STORY", "QUESTION", "EXPERIENCE", "OPINION"] | None, Query()] = None,
    include_deleted: Annotated[bool, Query()] = False,
    notice: Annotated[bool | None, Query()] = None,
) -> AdminCommunityPostListResponse:
    del current_admin
    now = utc_now()
    today_kst = now.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = today_kst.astimezone(UTC)
    seven_days_start = (today_kst - timedelta(days=6)).astimezone(UTC)
    visible_condition = CommunityPost.deleted_at.is_(None)
    comment_count = (
        select(func.count(CommunityComment.id))
        .where(CommunityComment.post_id == CommunityPost.id, CommunityComment.deleted_at.is_(None))
        .correlate(CommunityPost)
        .scalar_subquery()
    )

    total_posts = int(db.scalar(select(func.count(CommunityPost.id))) or 0)
    visible_posts = int(db.scalar(select(func.count(CommunityPost.id)).where(visible_condition)) or 0)
    deleted_posts = int(db.scalar(select(func.count(CommunityPost.id)).where(CommunityPost.deleted_at.is_not(None))) or 0)
    notice_posts = int(db.scalar(select(func.count(CommunityPost.id)).where(visible_condition, CommunityPost.is_notice.is_(True))) or 0)
    visible_comments = int(db.scalar(select(func.count(CommunityComment.id)).where(CommunityComment.deleted_at.is_(None))) or 0)

    conditions = []
    if not include_deleted:
        conditions.append(visible_condition)
    if q:
        pattern = f"%{q.strip()}%"
        conditions.append(or_(CommunityPost.title.ilike(pattern), CommunityPost.content.ilike(pattern), CommunityPost.place_name.ilike(pattern), User.nickname.ilike(pattern)))
    if category:
        conditions.append(CommunityPost.category == category)
    if notice is not None:
        conditions.append(CommunityPost.is_notice.is_(notice))

    filtered_total = int(db.scalar(select(func.count(CommunityPost.id)).join(User).where(*conditions)) or 0)
    rows = db.execute(
        select(CommunityPost, User.nickname, comment_count.label("comment_count"))
        .join(User)
        .where(*conditions)
        .order_by(CommunityPost.created_at.desc(), CommunityPost.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    category_rows = db.execute(
        select(CommunityPost.category, func.count(CommunityPost.id))
        .where(visible_condition)
        .group_by(CommunityPost.category)
    ).all()
    return AdminCommunityPostListResponse.model_validate({
        "summary": {
            "total": total_posts,
            "visible": visible_posts,
            "deleted": deleted_posts,
            "notices": notice_posts,
            "comments": visible_comments,
            "new_today": int(db.scalar(select(func.count(CommunityPost.id)).where(CommunityPost.created_at >= today_start, visible_condition)) or 0),
            "new_last_7_days": int(db.scalar(select(func.count(CommunityPost.id)).where(CommunityPost.created_at >= seven_days_start, visible_condition)) or 0),
        },
        "category_breakdown": [{"category": value, "count": count} for value, count in category_rows],
        "posts": [
            {
                "id": post.id,
                "title": post.title,
                "category": post.category,
                "author_nickname": nickname,
                "place_name": post.place_name,
                "is_notice": post.is_notice,
                "comment_count": int(count),
                "created_at": post.created_at,
                "updated_at": post.updated_at,
                "deleted_at": post.deleted_at,
            }
            for post, nickname, count in rows
        ],
        "total": filtered_total,
    })


def not_implemented() -> None:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")


@router.post("/detections/images", response_model=MessageResponse, summary="이미지 탐지 요청")
async def detect_image(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    inference_service: Annotated[DetectionInferenceService, Depends(get_inference_service)],
    camera_id: Annotated[int, Form(ge=1)],
    file: Annotated[UploadFile, File(description="탐지할 이미지")],
) -> MessageResponse:
    camera = db.scalar(select(Camera).where(Camera.id == camera_id, Camera.is_active.is_(True)))
    if camera is None:
        raise HTTPException(status_code=422, detail="활성 카메라를 선택해 주세요.")
    media_path, media_key = await save_upload_file(file, current_user=current_admin, allowed_types=IMAGE_CONTENT_TYPES, max_bytes=IMAGE_MAX_BYTES)
    try:
        event = create_operation_detection_event(db, current_admin=current_admin, camera=camera, source_type="IMAGE", media_key=media_key)
        process_detection_event(db, event_id=event.id, media_path=media_path, inference_service=inference_service)
    except DetectionModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="AI detection could not be completed") from exc
    return MessageResponse(message=f"Operation detection created: {event.id}")


@router.post("/detections/mobile-waste", response_model=AdminMobileWasteRegistrationResponse, status_code=status.HTTP_201_CREATED, summary="모바일 현장 폐기물 후보 등록")
async def register_mobile_waste(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    inference_service: Annotated[DetectionInferenceService, Depends(get_inference_service)],
    camera_id: Annotated[int, Form(ge=1)],
    file: Annotated[UploadFile, File(description="선택 시점의 JPEG 프레임")],
    bbox_x: Annotated[float, Form()],
    bbox_y: Annotated[float, Form()],
    bbox_width: Annotated[float, Form()],
    bbox_height: Annotated[float, Form()],
) -> AdminMobileWasteRegistrationResponse:
    camera = db.scalar(select(Camera).where(Camera.id == camera_id, Camera.is_active.is_(True)))
    if camera is None:
        raise HTTPException(status_code=422, detail="활성 카메라를 선택해 주세요.")
    media_path, media_key = await save_upload_file(
        file,
        current_user=current_admin,
        allowed_types={"image/jpeg": ".jpg"},
        max_bytes=WEBCAM_FRAME_MAX_BYTES,
    )
    detected_object = register_mobile_waste_candidate(
        db,
        admin=current_admin,
        camera=camera,
        media_path=media_path,
        media_key=media_key,
        selected_bbox=DetectionBBox(x=bbox_x, y=bbox_y, width=bbox_width, height=bbox_height),
        inference_service=inference_service,
    )
    return AdminMobileWasteRegistrationResponse(
        detection_event_id=detected_object.detection_event_id,
        detected_object_id=detected_object.id,
        processing_status="CONFIRMED",
        original_media_url=media_key,
        cropped_image_url=detected_object.cropped_image_url,
    )


@router.get("/cameras", response_model=list[AdminCameraResponse], summary="활성 운영 카메라 목록")
def list_cameras(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[Camera]:
    del current_admin
    return list(db.scalars(select(Camera).where(Camera.is_active.is_(True), Camera.latitude.is_not(None), Camera.longitude.is_not(None)).order_by(Camera.name, Camera.id)).all())


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
    if item is None or item.detection_event.purpose != "OPERATION":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detected object not found")
    previous_status = item.processing_status
    follow_up_completed = item.found_item is not None or item.id in waste_collection_completed_ids(db, [item.id])
    if request.final_class_code is not None:
        code = request.final_class_code.strip().upper()
        if get_object_class_by_code(db, code) is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid object class")
        current_code = (item.final_class or item.object_class).code
        if follow_up_completed and code != current_code:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed follow-up classification cannot be changed")
        item.final_class_code = code
    if request.processing_status is not None:
        if follow_up_completed and request.processing_status != item.processing_status:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed follow-up status cannot be changed")
        item.processing_status = request.processing_status
    if request.admin_memo is not None:
        item.admin_memo = clean_optional_text(request.admin_memo)
    if request.confirmed_color is not None:
        normalized_color = normalize_item_color(request.confirmed_color)
        if request.confirmed_color.strip() and normalized_color is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid item color")
        item.confirmed_color = normalized_color
        linked_found_item = db.scalar(select(FoundItem).where(FoundItem.detected_object_id == item.id))
        if linked_found_item is not None:
            linked_found_item.color = item.confirmed_color or item.ai_color
            linked_found_item.updated_at = utc_now()
            reconcile_match_candidates_for_found_item(db, linked_found_item)
    db.add(ProcessingHistory(actor_user_id=current_admin.id, entity_type="DETECTED_OBJECT", entity_id=item.id, action_type="DETECTED_OBJECT_REVIEWED", previous_status=previous_status, new_status=item.processing_status, note=item.admin_memo, created_at=utc_now()))
    db.commit()
    return MessageResponse(message="Detected object updated")


@router.get("/found-items", response_model=AdminFoundItemListResponse, summary="관리자 발견물 대장 조회")
def list_found_items_admin(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    item_status: Annotated[str | None, Query(alias="status")] = None,
    item_category: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    found_date: Annotated[datetime | None, Query()] = None,
) -> AdminFoundItemListResponse:
    normalized_status = item_status.strip().upper() if item_status else None
    if normalized_status and normalized_status not in FOUND_ITEM_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid found item status")
    items, total, status_counts = list_admin_found_items(db, skip=skip, limit=limit, status=normalized_status, item_category=item_category, q=q, found_date=found_date)
    return AdminFoundItemListResponse.model_validate({
        "items": [{
            "id": item.id, "item_category": item.object_class.code, "item_category_name": item.object_class.name_ko,
            "color": item.color, "public_description": item.public_description, "area_name": item.area_name,
            "found_at": item.found_at, "status": item.status, "source_type": item.source_type,
            "storage_location": item.storage_location, "image_url": representative_found_item_image_url(item),
            "created_at": item.created_at, "updated_at": item.updated_at,
        } for item in items],
        "total": total,
        "status_counts": [{"status": value, "count": count} for value, count in status_counts.items()],
    })


@router.patch("/found-items/{id}", response_model=MessageResponse, summary="발견물 수정")
def update_found_item(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, Path(ge=1)],
    request: FoundItemUpdateRequest,
) -> MessageResponse:
    item = get_found_item_by_id(db, id, for_update=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Found item not found")
    previous_status = item.status

    next_status = item.status
    next_area_name = item.area_name
    next_latitude = item.latitude
    next_longitude = item.longitude
    next_storage_location = item.storage_location
    next_admin_memo = item.admin_memo

    if request.status is not None:
        next_status = request.status.strip().upper()
        if next_status not in FOUND_ITEM_STATUSES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid found item status")
    if request.area_name is not None:
        cleaned_area_name = clean_optional_text(request.area_name)
        if cleaned_area_name is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="발견 지역을 입력해 주세요.")
        next_area_name = cleaned_area_name
    manual_coordinates = request.latitude is not None or request.longitude is not None
    if manual_coordinates:
        if request.latitude is None or request.longitude is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="위도와 경도는 함께 입력해 주세요.")
        next_latitude = request.latitude
        next_longitude = request.longitude
    if request.storage_location is not None:
        next_storage_location = clean_optional_text(request.storage_location)
    if request.admin_memo is not None:
        next_admin_memo = clean_optional_text(request.admin_memo)
    if next_status == "RECOVERED" and (next_latitude is None or next_longitude is None):
        try:
            coordinates = geocode_location(next_area_name)
        except GeocodingError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Kakao Local API 설정 또는 연결 문제로 발견 위치를 좌표로 변환하지 못했습니다. KAKAO_REST_API_KEY를 확인하거나 위도/경도를 직접 입력해 주세요.",
            ) from exc
        if coordinates is None:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="발견 위치를 지도에서 찾을 수 없습니다. 발견 지역을 더 구체적으로 수정하거나 위도/경도를 직접 입력해 주세요.",
            )
        next_latitude = Decimal(str(coordinates.latitude))
        next_longitude = Decimal(str(coordinates.longitude))
    if next_status != item.status and has_other_active_ownership_claim(
        db,
        found_item_id=item.id,
        claim_id=0,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Active ownership claim must be handled through the ownership claim workflow",
        )
    matching_relevant_changed = (
        next_status != item.status
        or next_area_name != item.area_name
        or next_latitude != item.latitude
        or next_longitude != item.longitude
    )
    item.status = next_status
    if item.status == "ARCHIVED":
        item.is_public = False
    item.area_name = next_area_name
    item.latitude = next_latitude
    item.longitude = next_longitude
    item.storage_location = next_storage_location
    item.admin_memo = next_admin_memo
    item.updated_at = utc_now()
    if matching_relevant_changed:
        reconcile_match_candidates_for_found_item(db, item)
    db.add(ProcessingHistory(actor_user_id=current_admin.id, entity_type="FOUND_ITEM", entity_id=item.id, action_type="FOUND_ITEM_UPDATED", previous_status=previous_status, new_status=item.status, note=item.admin_memo, created_at=item.updated_at))
    db.commit()
    return MessageResponse(message="Found item updated")


@router.post("/found-items/{id}/archive", response_model=MessageResponse, summary="발견물 보관")
def archive_found_item(
    current_admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, Path(ge=1)],
) -> MessageResponse:
    item = get_found_item_by_id(db, id, for_update=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Found item not found")
    if item.status != "ARCHIVED" and has_other_active_ownership_claim(db, found_item_id=item.id, claim_id=0):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Active ownership claim must be handled before archiving this found item",
        )
    previous_status = item.status
    item.status = "ARCHIVED"
    item.is_public = False
    item.updated_at = utc_now()
    reconcile_match_candidates_for_found_item(db, item)
    db.add(ProcessingHistory(actor_user_id=current_admin.id, entity_type="FOUND_ITEM", entity_id=item.id, action_type="FOUND_ITEM_ARCHIVED", previous_status=previous_status, new_status=item.status, note=item.admin_memo, created_at=item.updated_at))
    db.commit()
    return MessageResponse(message="Found item archived")


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
