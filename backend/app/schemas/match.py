from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.found_item import FoundItemListItemResponse
from app.schemas.lost_report import LostReportResponse


class MatchCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lost_report: LostReportResponse
    found_item: FoundItemListItemResponse
    total_score: int
    type_score: int
    area_score: int
    time_score: int
    keyword_score: int
    status: str
    created_at: datetime
