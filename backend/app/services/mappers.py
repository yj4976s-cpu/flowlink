from __future__ import annotations

from app.models import DetectedObject, DetectionEvent, FoundItem, LostReport, MatchCandidate, Notification, OwnershipClaim, User
from app.schemas.admin import (
    AdminClaimantSummary,
    AdminFoundItemSummary,
    AdminLostReportSummary,
    AdminOwnershipClaimResponse,
)
from app.schemas.auth import UserResponse
from app.schemas.detection import DetectionBBoxResponse, DetectionEventResponse, DetectionObjectResponse
from app.schemas.found_item import FoundItemDetailResponse, FoundItemListItemResponse, FoundItemMapItemResponse
from app.schemas.lost_report import LostReportResponse
from app.schemas.match import MatchCandidateResponse, MatchFoundItemResponse
from app.schemas.notification import NotificationResponse
from app.schemas.ownership_claim import OwnershipClaimResponse
from app.services.found_item_images import representative_found_item_image_url


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
        source_type=found_item.source_type,
        image_url=representative_found_item_image_url(found_item),
    )


def found_item_detail_response(found_item: FoundItem) -> FoundItemDetailResponse:
    return FoundItemDetailResponse(
        **found_item_list_response(found_item).model_dump(),
        created_at=found_item.created_at,
    )


def found_item_map_response(found_item: FoundItem) -> FoundItemMapItemResponse:
    return FoundItemMapItemResponse(
        **found_item_list_response(found_item).model_dump(),
        latitude=float(found_item.latitude),
        longitude=float(found_item.longitude),
    )


def lost_report_response(lost_report: LostReport) -> LostReportResponse:
    return LostReportResponse(
        id=lost_report.id,
        item_category=lost_report.object_class.code,
        item_category_name=lost_report.object_class.name_ko,
        color=lost_report.color,
        colors=lost_report.colors or ([lost_report.color] if lost_report.color else []),
        description=lost_report.description,
        area_name=lost_report.area_name,
        latitude=float(lost_report.latitude) if lost_report.latitude is not None else None,
        longitude=float(lost_report.longitude) if lost_report.longitude is not None else None,
        lost_from=lost_report.lost_from,
        lost_to=lost_report.lost_to,
        image_url=lost_report.image_url,
        status=lost_report.status,
        created_at=lost_report.created_at,
    )


def match_candidate_response(candidate: MatchCandidate) -> MatchCandidateResponse:
    return MatchCandidateResponse(
        id=candidate.id,
        lost_report=lost_report_response(candidate.lost_report),
        found_item=MatchFoundItemResponse(
            **found_item_list_response(candidate.found_item).model_dump(),
        ),
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


def admin_ownership_claim_response(claim: OwnershipClaim) -> AdminOwnershipClaimResponse:
    lost_report = claim.lost_report
    return AdminOwnershipClaimResponse(
        id=claim.id,
        status=claim.status,
        verification_details=claim.verification_details,
        reviewed_by=claim.reviewed_by,
        reviewed_at=claim.reviewed_at,
        admin_memo=claim.admin_memo,
        created_at=claim.created_at,
        claimant=AdminClaimantSummary(
            id=claim.user.id,
            nickname=claim.user.nickname,
        ),
        found_item=AdminFoundItemSummary(
            id=claim.found_item.id,
            item_category=claim.found_item.object_class.code,
            item_category_name=claim.found_item.object_class.name_ko,
            color=claim.found_item.color,
            public_description=claim.found_item.public_description,
            private_features=claim.found_item.private_features,
            area_name=claim.found_item.area_name,
            found_at=claim.found_item.found_at,
            status=claim.found_item.status,
            is_public=claim.found_item.is_public,
        ),
        lost_report=AdminLostReportSummary(
            id=lost_report.id,
            item_category=lost_report.object_class.code,
            item_category_name=lost_report.object_class.name_ko,
            color=lost_report.color,
            description=lost_report.description,
            area_name=lost_report.area_name,
            lost_from=lost_report.lost_from,
            lost_to=lost_report.lost_to,
            status=lost_report.status,
        ) if lost_report is not None else None,
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


def detection_object_response(detected_object: DetectedObject) -> DetectionObjectResponse:
    object_class = detected_object.object_class
    return DetectionObjectResponse(
        id=detected_object.id,
        class_code=object_class.code,
        class_name_ko=object_class.name_ko,
        group_code=object_class.group_code,
        confidence=float(detected_object.confidence),
        bbox=DetectionBBoxResponse(
            x=float(detected_object.bbox_x),
            y=float(detected_object.bbox_y),
            width=float(detected_object.bbox_width),
            height=float(detected_object.bbox_height),
        ),
        track_id=detected_object.track_id,
        first_seen_ms=detected_object.first_seen_ms,
        last_seen_ms=detected_object.last_seen_ms,
        appearance_count=detected_object.appearance_count,
    )


def detection_event_response(event: DetectionEvent) -> DetectionEventResponse:
    return DetectionEventResponse(
        id=event.id,
        source_type=event.source_type,
        status=event.status,
        purpose=event.purpose,
        original_media_url=event.original_media_url,
        result_media_url=event.result_media_url,
        ai_model_id=event.ai_model_id,
        media_width=event.media_width,
        media_height=event.media_height,
        created_at=event.created_at,
        processing_started_at=event.processing_started_at,
        processing_completed_at=event.processing_completed_at,
        detected_objects=[detection_object_response(detected_object) for detected_object in event.detected_objects],
    )
