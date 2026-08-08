from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LostReportCreateRequest(BaseModel):
    item_category: str = Field(min_length=1, max_length=50)
    color: str | None = Field(default=None, max_length=50)
    description: str = Field(min_length=1)
    lost_location: str = Field(min_length=1, max_length=100)
    lost_at: datetime

    @field_validator("item_category", "description", "lost_location", mode="before")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("color", mode="before")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() if isinstance(value, str) else value

    @field_validator("lost_at")
    @classmethod
    def require_timezone_aware_lost_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("lost_at must include timezone information")
        return value.astimezone(UTC)


class LostReportResponse(BaseModel):
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
    created_at: datetime
