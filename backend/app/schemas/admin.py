from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DetectedObjectUpdateRequest(BaseModel):
    final_class_code: str | None = None
    processing_status: str | None = None
    admin_memo: str | None = None


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
