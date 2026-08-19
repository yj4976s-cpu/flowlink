from datetime import datetime

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DetectedObjectUpdateRequest(BaseModel):
    final_class_code: str | None = None
    processing_status: Literal["PENDING", "CONFIRMED", "REJECTED"] | None = None
    admin_memo: str | None = None
    confirmed_color: str | None = None


class AdminDetectedObjectResponse(BaseModel):
    id: int
    object_class: str
    object_class_name: str
    final_class_code: str | None
    confidence: Decimal
    bbox_x: Decimal
    bbox_y: Decimal
    bbox_width: Decimal
    bbox_height: Decimal
    cropped_image_url: str | None
    ai_color: str | None
    confirmed_color: str | None
    detected_at: datetime
    processing_status: str
    admin_memo: str | None
    track_id: int | None
    first_seen_ms: int | None
    last_seen_ms: int | None
    appearance_count: int
    follow_up_kind: Literal["FOUND_ITEM", "WASTE", "NONE"]
    found_item_id: int | None
    waste_collection_completed: bool


class AdminDetectedObjectFoundItemResponse(BaseModel):
    detected_object_id: int
    found_item_id: int
    source_type: Literal["AI"]
    follow_up_status: Literal["COMPLETED"] = "COMPLETED"


class AdminCameraResponse(BaseModel):
    id: int
    code: str
    name: str
    area_name: str
    latitude: Decimal
    longitude: Decimal


class AdminDetectedObjectCollectionResponse(BaseModel):
    detected_object_id: int
    waste_collection_completed: Literal[True] = True
    follow_up_status: Literal["COMPLETED"] = "COMPLETED"


class AdminDetectionEventResponse(BaseModel):
    id: int
    purpose: Literal["OPERATION", "USER_ANALYSIS"]
    source_type: str
    original_media_url: str
    result_media_url: str | None
    status: str
    captured_at: datetime
    processing_started_at: datetime | None
    processing_completed_at: datetime | None
    error_message: str | None
    camera_id: int | None
    detected_objects: list[AdminDetectedObjectResponse]


class AdminClaimantSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nickname: str


class AdminFoundItemSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_category: str
    item_category_name: str
    color: str | None
    public_description: str | None
    private_features: str | None
    area_name: str
    found_at: datetime
    status: str
    is_public: bool


class AdminLostReportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_category: str
    item_category_name: str
    color: str | None
    description: str
    area_name: str
    lost_from: datetime
    lost_to: datetime | None
    status: str


class AdminOwnershipClaimResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    verification_details: str
    reviewed_by: int | None
    reviewed_at: datetime | None
    admin_memo: str | None
    created_at: datetime
    claimant: AdminClaimantSummary
    found_item: AdminFoundItemSummary
    lost_report: AdminLostReportSummary | None


class AdminFoundItemListItem(BaseModel):
    id: int
    item_category: str
    item_category_name: str
    color: str | None
    public_description: str | None
    area_name: str
    found_at: datetime
    status: str
    source_type: str
    storage_location: str | None
    image_url: str | None
    created_at: datetime
    updated_at: datetime


class AdminFoundItemStatusCount(BaseModel):
    status: str
    count: int


class AdminFoundItemListResponse(BaseModel):
    items: list[AdminFoundItemListItem]
    total: int
    status_counts: list[AdminFoundItemStatusCount]


class AdminDashboardMetrics(BaseModel):
    discovered: int
    ai_detections: int
    official_found_items: int
    confirmed: int
    matched: int
    claims: int
    approved: int
    returned: int
    lost_reports: int
    match_notifications: int
    citizen_reports: int
    citizen_pending: int
    operation_detection_pending: int
    waste_collection_pending: int
    citizen_review_pending: int
    ownership_claim_pending: int
    ownership_return_pending: int
    citizen_linked: int
    citizen_sightings: int


class AdminDashboardFlowTrace(BaseModel):
    detection_id: int | None = None
    detected_object_id: int | None = None
    found_item_id: int | None = None
    lost_report_id: int | None = None
    match_candidate_id: int | None = None
    notification_id: int | None = None
    ownership_claim_id: int | None = None
    returned: bool = False


class AdminDashboardActivity(BaseModel):
    kind: str
    entity_id: int
    label: str
    occurred_at: datetime


class AdminDashboardRecentItem(BaseModel):
    id: int
    item_category: str
    item_category_name: str
    color: str | None
    public_description: str | None
    area_name: str
    found_at: datetime
    status: str
    image_url: str | None


class AdminDashboardCategoryCount(BaseModel):
    code: str
    name: str
    count: int


class AdminDashboardClaimStatusCount(BaseModel):
    status: str
    count: int


class AdminDashboardRecentDetection(BaseModel):
    id: int
    detection_event_id: int
    item_category: str
    item_category_name: str
    confidence: Decimal
    image_url: str | None
    detected_at: datetime
    processing_status: str


class AdminDashboardHistory(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    action_type: str
    new_status: str | None
    note: str | None
    created_at: datetime


class AdminDashboardTrendPoint(BaseModel):
    label: str
    discovered: int
    matched: int
    returned: int


class AdminDashboardResponse(BaseModel):
    period: str
    metrics: AdminDashboardMetrics
    recent_items: list[AdminDashboardRecentItem]
    recent_detections: list[AdminDashboardRecentDetection]
    category_counts: list[AdminDashboardCategoryCount]
    claim_status_counts: list[AdminDashboardClaimStatusCount]
    average_confidence: Decimal | None = Field(default=None)
    recent_history: list[AdminDashboardHistory]
    trend: list[AdminDashboardTrendPoint]
    latest_flow: AdminDashboardFlowTrace | None = None
    recent_activity: list[AdminDashboardActivity]


class AdminAiReportSummary(BaseModel):
    total: int
    average_confidence: Decimal | None = None
    reviewed: int
    corrected: int


class AdminAiReportClassMetric(BaseModel):
    code: str
    name: str
    count: int
    average_confidence: Decimal | None = None
    reviewed: int
    corrected: int


class AdminAiReportConfidenceBucket(BaseModel):
    key: str
    label: str
    count: int


class AdminAiReportCorrectionPattern(BaseModel):
    predicted_code: str
    predicted_name: str
    final_code: str
    final_name: str
    count: int


class AdminAiReportResponse(BaseModel):
    summary: AdminAiReportSummary
    class_metrics: list[AdminAiReportClassMetric]
    confidence_distribution: list[AdminAiReportConfidenceBucket]
    correction_patterns: list[AdminAiReportCorrectionPattern]
