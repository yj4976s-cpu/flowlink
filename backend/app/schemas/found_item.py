from datetime import datetime

from pydantic import BaseModel, ConfigDict


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


class FoundItemUpdateRequest(BaseModel):
    status: str | None = None
    storage_location: str | None = None
    admin_memo: str | None = None
