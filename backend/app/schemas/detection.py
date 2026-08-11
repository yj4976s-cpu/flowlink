from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DetectionBBoxResponse(BaseModel):
    x: float
    y: float
    width: float
    height: float


class DetectionObjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_code: str
    class_name_ko: str
    group_code: str
    confidence: float
    bbox: DetectionBBoxResponse
    track_id: int | None
    first_seen_ms: int | None
    last_seen_ms: int | None
    appearance_count: int


class DetectionEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: str
    status: str
    purpose: str
    media_width: int | None
    media_height: int | None
    created_at: datetime
    processing_started_at: datetime | None
    processing_completed_at: datetime | None
    detected_objects: list[DetectionObjectResponse] = Field(default_factory=list)


class DetectionEventListResponse(DetectionEventResponse):
    pass


class WebcamDetectionObjectResponse(BaseModel):
    label: str
    confidence: float
    bbox: DetectionBBoxResponse


class WebcamDetectionFrameResponse(BaseModel):
    media_width: int
    media_height: int
    inference_ms: float
    detected_objects: list[WebcamDetectionObjectResponse] = Field(default_factory=list)
