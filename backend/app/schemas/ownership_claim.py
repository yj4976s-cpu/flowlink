from pydantic import BaseModel, Field


class OwnershipClaimCreateRequest(BaseModel):
    found_item_id: int = Field(ge=1)
    lost_report_id: int | None = Field(default=None, ge=1)
    verification_details: str = Field(min_length=10, max_length=1000)


class OwnershipClaimUpdateRequest(BaseModel):
    status: str
    admin_memo: str | None = None
