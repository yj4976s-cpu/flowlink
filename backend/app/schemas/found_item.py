from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class FoundItemListItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_category: str
    item_category_name: str
    color: str | None
    public_description: str | None
    area_name: str
    found_at: datetime
    status: str
    source_type: str
    image_url: str | None


class FoundItemDetailResponse(FoundItemListItemResponse):
    created_at: datetime


class FoundItemMapItemResponse(FoundItemListItemResponse):
    latitude: float
    longitude: float


class FoundItemUpdateRequest(BaseModel):
    status: str | None = None
    area_name: str | None = Field(default=None, min_length=1, max_length=100)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    storage_location: str | None = None
    admin_memo: str | None = None
