from pydantic import BaseModel


class DetectedObjectUpdateRequest(BaseModel):
    final_class_code: str | None = None
    processing_status: str | None = None
    admin_memo: str | None = None
