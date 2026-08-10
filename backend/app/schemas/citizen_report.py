from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

CitizenReportStatus = Literal["PENDING", "UNDER_REVIEW", "LINKED", "REJECTED", "CANCELLED"]


class CitizenSightingResponse(BaseModel):
    id: int
    sighted_at: datetime
    location_name: str
    description: str
    image_url: str | None
    created_at: datetime


class LinkedFoundItemSummary(BaseModel):
    id: int
    status: str


class CitizenReportResponse(BaseModel):
    id: int
    item_category: str
    item_category_name: str
    color: str | None
    description: str
    image_url: str | None
    area_name: str
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    found_at: datetime
    status: CitizenReportStatus
    sighting_count: int
    sightings: list[CitizenSightingResponse] = []
    linked_found_item: LinkedFoundItemSummary | None = None
    created_at: datetime
    updated_at: datetime


class CitizenReportUpdateRequest(BaseModel):
    object_class: str | None = None
    color: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, min_length=5, max_length=1000)
    area_name: str | None = Field(default=None, min_length=1, max_length=100)
    found_at: datetime | None = None


class AdminCitizenReportUpdateRequest(BaseModel):
    status: Literal["UNDER_REVIEW", "REJECTED"]
    rejection_reason: str | None = Field(default=None, max_length=1000)
    admin_memo: str | None = Field(default=None, max_length=2000)


class FoundItemFromCitizenRequest(BaseModel):
    object_class: str
    color: str | None = Field(default=None, max_length=50)
    public_description: str | None = Field(default=None, max_length=500)
    private_features: str | None = None
    area_name: str = Field(min_length=1, max_length=100)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    found_at: datetime
    storage_location: str | None = Field(default=None, max_length=255)


class ResolveCitizenReportRequest(BaseModel):
    mode: Literal["LINK_EXISTING", "CREATE_FOUND_ITEM"]
    found_item_id: int | None = Field(default=None, ge=1)
    found_item: FoundItemFromCitizenRequest | None = None


class AdminCitizenReportResponse(CitizenReportResponse):
    user_id: int
    user_nickname: str
    reviewed_by: int | None
    reviewed_at: datetime | None
    rejection_reason: str | None
    admin_memo: str | None
    linked_at: datetime | None
