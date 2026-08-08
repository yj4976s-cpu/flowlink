from __future__ import annotations

from app.models import FoundItem, LostReport, MatchCandidate, Notification, OwnershipClaim, User
from app.schemas.auth import UserResponse
from app.schemas.found_item import FoundItemDetailResponse, FoundItemListItemResponse
from app.schemas.lost_report import LostReportResponse
from app.schemas.match import MatchCandidateResponse
from app.schemas.notification import NotificationResponse
from app.schemas.ownership_claim import OwnershipClaimResponse


def user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        role=user.role,
        active=user.active,
        created_at=user.created_at,
    )


def found_item_list_response(found_item: FoundItem) -> FoundItemListItemResponse:
    return FoundItemListItemResponse(
        id=found_item.id,
        item_category=found_item.object_class.code,
        item_category_name=found_item.object_class.name_ko,
        color=found_item.color,
        public_description=found_item.public_description,
        area_name=found_item.area_name,
        found_at=found_item.found_at,
        status=found_item.status,
    )


def found_item_detail_response(found_item: FoundItem) -> FoundItemDetailResponse:
    return FoundItemDetailResponse(
        **found_item_list_response(found_item).model_dump(),
        created_at=found_item.created_at,
    )


def lost_report_response(lost_report: LostReport) -> LostReportResponse:
    return LostReportResponse(
        id=lost_report.id,
        item_category=lost_report.object_class.code,
        item_category_name=lost_report.object_class.name_ko,
        color=lost_report.color,
        description=lost_report.description,
        area_name=lost_report.area_name,
        lost_from=lost_report.lost_from,
        lost_to=lost_report.lost_to,
        status=lost_report.status,
        created_at=lost_report.created_at,
    )


def match_candidate_response(candidate: MatchCandidate) -> MatchCandidateResponse:
    return MatchCandidateResponse(
        id=candidate.id,
        lost_report=lost_report_response(candidate.lost_report),
        found_item=found_item_list_response(candidate.found_item),
        total_score=candidate.total_score,
        type_score=candidate.type_score,
        area_score=candidate.area_score,
        time_score=candidate.time_score,
        keyword_score=candidate.keyword_score,
        status=candidate.status,
        created_at=candidate.created_at,
    )


def ownership_claim_response(claim: OwnershipClaim) -> OwnershipClaimResponse:
    return OwnershipClaimResponse(
        id=claim.id,
        user_id=claim.user_id,
        found_item_id=claim.found_item_id,
        lost_report_id=claim.lost_report_id,
        status=claim.status,
        verification_details=claim.verification_details,
        reviewed_by=claim.reviewed_by,
        reviewed_at=claim.reviewed_at,
        admin_memo=claim.admin_memo,
        created_at=claim.created_at,
    )


def notification_response(notification: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=notification.id,
        notification_type=notification.notification_type,
        title=notification.title,
        message=notification.message,
        related_type=notification.related_type,
        related_id=notification.related_id,
        read_at=notification.read_at,
        created_at=notification.created_at,
    )
