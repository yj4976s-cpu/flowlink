from datetime import datetime

from pydantic import BaseModel


class HomeStatsResponse(BaseModel):
    recent_found: int
    matching_active: int
    returned: int
    today_detections: int


class HomeRecentItemResponse(BaseModel):
    id: int
    category: str
    title: str
    location: str
    image_url: str | None
    confidence: int | None
    found_at: datetime
    object_kind: str


class HomeSummaryResponse(BaseModel):
    stats: HomeStatsResponse
    recent_items: list[HomeRecentItemResponse]
