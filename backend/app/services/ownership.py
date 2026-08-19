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
    get_claimable_found_item_by_id,
    get_existing_ownership_claim,
    get_lost_report_for_user,
    get_match_candidate,
    get_ownership_claim_by_id,
    has_other_active_ownership_claim,
    list_ownership_claims_for_user,
    list_representative_ownership_claims_for_user_reports,
)
from app.schemas.ownership_claim import OwnershipClaimCreateRequest, OwnershipClaimResponse, OwnershipClaimUpdateRequest
from app.services.mappers import ownership_claim_response
from app.services.matching import reconcile_match_candidates_for_found_item

ADMIN_CLAIM_STATUSES = {"APPROVED", "REJECTED", "RETURNED"}
CLAIMABLE_LOST_REPORT_STATUSES = {"OPEN", "MATCHED"}
CLAIM_TRANSITIONS = {
    "PENDING": {"APPROVED", "REJECTED"},
    "APPROVED": {"RETURNED"},
    "REJECTED": set(),
    "RETURNED": set(),
}


def list_claims_for_user(
    db: Session,
    *,
    current_user: User,
    skip: int,
    limit: int,
) -> list[OwnershipClaimResponse]:
    claims = list_ownership_claims_for_user(
        db,
        current_user.id,
        skip=skip,
        limit=limit,
    )
    return [ownership_claim_response(claim) for claim in claims]


def list_claim_progress_for_user(
    db: Session,
    *,
    current_user: User,
    lost_report_ids: list[int],
) -> list[OwnershipClaimResponse]:
    claims = list_representative_ownership_claims_for_user_reports(db, current_user.id, lost_report_ids)
    return [ownership_claim_response(claim) for claim in claims]


def create_claim_for_user(
    db: Session,
    *,
    current_user: User,
    request: OwnershipClaimCreateRequest,
) -> OwnershipClaimResponse:
    found_item = get_claimable_found_item_by_id(db, request.found_item_id, for_update=True)
    if found_item is None:
        # 비공개이거나 claim 불가능한 발견물도 404로 숨겨 ID 존재 여부를 노출하지 않는다.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Found item not found")
    if has_other_active_ownership_claim(db, found_item_id=found_item.id, claim_id=0):
        # MVP에서는 AVAILABLE 발견물에 최초 claim 한 건만 활성화한다.
        # 상태 데이터가 어긋난 경우에도 새 활성 claim을 만들지 않도록 claim 불가 대상으로 숨긴다.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Found item not found")

    lost_report = None
    if request.lost_report_id is not None:
        # lost_report_id는 클라이언트가 전달하므로 현재 사용자 소유인지 반드시 다시 확인한다.
        # ID만 알고 타 사용자의 신고를 소유권 증빙으로 연결하는 IDOR를 막기 위한 검증이다.
        lost_report = get_lost_report_for_user(db, request.lost_report_id, current_user.id)
        if lost_report is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lost report not found")
        if lost_report.status not in CLAIMABLE_LOST_REPORT_STATUSES:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lost report is not claimable")
        if lost_report.object_class_id != found_item.object_class_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Lost report category does not match found item",
            )

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
        # claim 생성과 상태 변경은 함께 성공하거나 함께 실패해야 관리자 화면에 반쪽 상태가 남지 않는다.
        found_item.status = "CLAIM_PENDING"
        found_item.updated_at = now
        if lost_report is not None:
            lost_report.status = "CLAIM_PENDING"
            lost_report.updated_at = now
            match_candidate = get_match_candidate(
                db, lost_report_id=lost_report.id, found_item_id=found_item.id
            )
            if match_candidate is not None:
                match_candidate.status = "CLAIMED"
                match_candidate.updated_at = now
        reconcile_match_candidates_for_found_item(db, found_item)
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

    previous_claim_status = claim.status
    if next_status == previous_claim_status:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ownership claim already has this status")
    if next_status not in CLAIM_TRANSITIONS.get(previous_claim_status, set()):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid ownership claim status transition")

    now = utc_now()
    previous_found_status = claim.found_item.status
    previous_lost_status = claim.lost_report.status if claim.lost_report else None

    claim.status = next_status
    claim.reviewed_by = current_admin.id
    claim.reviewed_at = now
    claim.admin_memo = clean_optional_text(request.admin_memo)
    claim.updated_at = now

    if next_status == "REJECTED":
        has_other_active_claim = has_other_active_ownership_claim(
            db,
            found_item_id=claim.found_item_id,
            claim_id=claim.id,
        )
        if not has_other_active_claim and claim.found_item.status == "CLAIM_PENDING":
            claim.found_item.status = "AVAILABLE"
            claim.found_item.updated_at = now
        if claim.lost_report is not None and claim.lost_report.status == "CLAIM_PENDING":
            claim.lost_report.status = "MATCHED" if claim.lost_report.match_candidates else "OPEN"
            claim.lost_report.updated_at = now
            match_candidate = get_match_candidate(
                db, lost_report_id=claim.lost_report.id, found_item_id=claim.found_item_id
            )
            if match_candidate is not None and match_candidate.status == "CLAIMED":
                match_candidate.status = "NOTIFIED"
                match_candidate.updated_at = now
        if claim.found_item.status == "AVAILABLE":
            reconcile_match_candidates_for_found_item(db, claim.found_item)
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
