from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OwnershipClaimCreateRequest(BaseModel):
    found_item_id: int = Field(ge=1)
    lost_report_id: int | None = Field(default=None, ge=1)
    verification_details: str = Field(min_length=10, max_length=1000)


class OwnershipClaimUpdateRequest(BaseModel):
    status: str
    admin_memo: str | None = None


class OwnershipClaimResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    found_item_id: int
    lost_report_id: int | None
    status: str
    verification_details: str
    reviewed_by: int | None
    reviewed_at: datetime | None
    admin_memo: str | None
    created_at: datetime
