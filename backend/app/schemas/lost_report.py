from datetime import datetime

from pydantic import BaseModel


class LostReportCreateRequest(BaseModel):
    item_category: str
    color: str | None = None
    description: str
    lost_location: str
    lost_at: datetime
