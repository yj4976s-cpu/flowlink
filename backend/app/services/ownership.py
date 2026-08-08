from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import Notification, OwnershipClaim, ProcessingHistory, User
from app.repositories.user_flow import (
    add_notification,
    add_ownership_claim,
    add_processing_history,
    clean_optional_text,
    get_existing_ownership_claim,
    get_found_item_by_id,
    get_lost_report_for_user,
    get_ownership_claim_by_id,
)
from app.schemas.ownership_claim import OwnershipClaimCreateRequest, OwnershipClaimResponse, OwnershipClaimUpdateRequest
from app.services.mappers import ownership_claim_response

FINAL_FOUND_ITEM_STATUSES = {"RETURNED", "DISPOSED"}
ADMIN_CLAIM_STATUSES = {"APPROVED", "REJECTED", "RETURNED"}


def create_claim_for_user(
    db: Session,
    *,
    current_user: User,
    request: OwnershipClaimCreateRequest,
) -> OwnershipClaimResponse:
    found_item = get_found_item_by_id(db, request.found_item_id)
    if found_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Found item not found")
    if found_item.status in FINAL_FOUND_ITEM_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Found item is not claimable")

    lost_report = None
    if request.lost_report_id is not None:
        # lost_report_id를 클라이언트가 전달하더라도 현재 사용자 소유인지 다시 확인한다.
        # ID만 알고 타 사용자의 신고를 소유권 증빙으로 연결하는 IDOR를 막기 위한 검증이다.
        lost_report = get_lost_report_for_user(db, request.lost_report_id, current_user.id)
        if lost_report is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lost report not found")

    details = clean_optional_text(request.verification_details)
    if details is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Verification details are required")

    if get_existing_ownership_claim(
        db,
        user_id=current_user.id,
        found_item_id=request.found_item_id,
        lost_report_id=request.lost_report_id,
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ownership claim already exists")

    now = utc_now()
    claim = OwnershipClaim(
        user_id=current_user.id,
        found_item_id=request.found_item_id,
        lost_report_id=request.lost_report_id,
        verification_details=details,
        status="PENDING",
        created_at=now,
        updated_at=now,
    )
    previous_found_status = found_item.status
    previous_lost_status = lost_report.status if lost_report else None

    try:
        add_ownership_claim(db, claim)
        # 소유권 요청과 대상 상태 변경은 함께 성공하거나 함께 실패해야 프론트와 관리자 화면의 상태가 어긋나지 않는다.
        found_item.status = "CLAIM_PENDING"
        found_item.updated_at = now
        if lost_report is not None:
            lost_report.status = "CLAIM_PENDING"
            lost_report.updated_at = now
        add_processing_history(
            db,
            ProcessingHistory(
                entity_type="FOUND_ITEM",
                entity_id=found_item.id,
                action_type="OWNERSHIP_CLAIM_CREATED",
                previous_status=previous_found_status,
                new_status=found_item.status,
                created_at=now,
            ),
        )
        if lost_report is not None:
            add_processing_history(
                db,
                ProcessingHistory(
                    entity_type="LOST_REPORT",
                    entity_id=lost_report.id,
                    action_type="OWNERSHIP_CLAIM_CREATED",
                    previous_status=previous_lost_status,
                    new_status=lost_report.status,
                    created_at=now,
                ),
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ownership claim already exists") from exc

    db.refresh(claim)
    return ownership_claim_response(claim)


def review_ownership_claim(
    db: Session,
    *,
    current_admin: User,
    claim_id: int,
    request: OwnershipClaimUpdateRequest,
) -> OwnershipClaimResponse:
    next_status = request.status.strip().upper()
    if next_status not in ADMIN_CLAIM_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid ownership claim status")

    claim = get_ownership_claim_by_id(db, claim_id)
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ownership claim not found")

    now = utc_now()
    previous_claim_status = claim.status
    previous_found_status = claim.found_item.status
    previous_lost_status = claim.lost_report.status if claim.lost_report else None

    claim.status = next_status
    claim.reviewed_by = current_admin.id
    claim.reviewed_at = now
    claim.admin_memo = clean_optional_text(request.admin_memo)
    claim.updated_at = now

    if next_status == "REJECTED":
        claim.found_item.status = "AVAILABLE"
        claim.found_item.updated_at = now
        if claim.lost_report is not None:
            claim.lost_report.status = "MATCHED" if claim.lost_report.match_candidates else "OPEN"
            claim.lost_report.updated_at = now
    elif next_status == "RETURNED":
        claim.found_item.status = "RETURNED"
        claim.found_item.updated_at = now
        if claim.lost_report is not None:
            claim.lost_report.status = "RESOLVED"
            claim.lost_report.updated_at = now

    # 관리자 검토는 claim, found_item, lost_report의 의미가 함께 바뀌므로 한 transaction에서 이력을 남긴다.
    add_processing_history(
        db,
        ProcessingHistory(
            actor_user_id=current_admin.id,
            entity_type="OWNERSHIP_CLAIM",
            entity_id=claim.id,
            action_type="OWNERSHIP_CLAIM_REVIEWED",
            previous_status=previous_claim_status,
            new_status=claim.status,
            note=claim.admin_memo,
            created_at=now,
        ),
    )
    if previous_found_status != claim.found_item.status:
        add_processing_history(
            db,
            ProcessingHistory(
                actor_user_id=current_admin.id,
                entity_type="FOUND_ITEM",
                entity_id=claim.found_item.id,
                action_type="OWNERSHIP_CLAIM_REVIEWED",
                previous_status=previous_found_status,
                new_status=claim.found_item.status,
                note=claim.admin_memo,
                created_at=now,
            ),
        )
    if claim.lost_report is not None and previous_lost_status != claim.lost_report.status:
        add_processing_history(
            db,
            ProcessingHistory(
                actor_user_id=current_admin.id,
                entity_type="LOST_REPORT",
                entity_id=claim.lost_report.id,
                action_type="OWNERSHIP_CLAIM_REVIEWED",
                previous_status=previous_lost_status,
                new_status=claim.lost_report.status,
                note=claim.admin_memo,
                created_at=now,
            ),
        )

    add_notification(
        db,
        Notification(
            user_id=claim.user_id,
            notification_type="STATUS_CHANGED",
            title="소유권 확인 상태가 변경되었습니다",
            message=f"소유권 확인 요청 상태가 {next_status}(으)로 변경되었습니다.",
            related_type="OWNERSHIP_CLAIM",
            related_id=claim.id,
            created_at=now,
        ),
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Could not update ownership claim") from exc

    db.refresh(claim)
    return ownership_claim_response(claim)
