from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class LostReportCreateRequest(BaseModel):
    item_category: str
    color: str | None = None
    description: str = Field(min_length=1)
    lost_location: str = Field(min_length=1)
    lost_at: datetime


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
