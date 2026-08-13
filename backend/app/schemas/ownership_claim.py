from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OwnershipClaimCreateRequest(BaseModel):
    found_item_id: int = Field(ge=1)
    lost_report_id: int | None = Field(default=None, ge=1)
    verification_details: str = Field(min_length=10, max_length=1000)

    @field_validator("verification_details", mode="before")
    @classmethod
    def strip_verification_details(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class OwnershipClaimUpdateRequest(BaseModel):
    status: str = Field(min_length=1, max_length=20)
    admin_memo: str | None = None

    @field_validator("status", mode="before")
    @classmethod
    def strip_status(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


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
