from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LostReportCreateRequest(BaseModel):
    item_category: str = Field(min_length=1, max_length=50)
    color: str | None = Field(default=None, max_length=50)
    colors: list[str] = Field(default_factory=list, max_length=3)
    description: str = Field(min_length=1)
    lost_location: str = Field(min_length=1, max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    lost_at: datetime

    @model_validator(mode="after")
    def require_coordinate_pair(self) -> "LostReportCreateRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self

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

    @field_validator("colors", mode="before")
    @classmethod
    def normalize_colors(cls, value: list[str] | None) -> list[str]:
        normalized: list[str] = []
        for item in value or []:
            color = item.strip() if isinstance(item, str) else ""
            if color and color not in normalized:
                normalized.append(color)
        if len(normalized) > 3 or any(len(color) > 50 for color in normalized):
            raise ValueError("colors must contain up to 3 values of 50 characters or fewer")
        if "여러 색" in normalized and len(normalized) > 1:
            raise ValueError("여러 색 cannot be combined with other colors")
        return normalized

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
    colors: list[str]
    description: str
    area_name: str
    latitude: float | None
    longitude: float | None
    lost_from: datetime
    lost_to: datetime | None
    image_url: str | None
    status: str
    created_at: datetime
