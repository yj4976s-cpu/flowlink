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
    original_media_url: str
    result_media_url: str | None
    ai_model_id: str | None = None
    media_width: int | None
    media_height: int | None
    created_at: datetime
    processing_started_at: datetime | None
    processing_completed_at: datetime | None
    detected_objects: list[DetectionObjectResponse] = Field(default_factory=list)


class DetectionEventListResponse(DetectionEventResponse):
    pass


class VideoDetectionAcceptedResponse(BaseModel):
    detection_event_id: int
    video_job_id: int
    status: str
    stage: str


class VideoProcessingStatusResponse(BaseModel):
    detection_event_id: int
    video_job_id: int
    status: str
    stage: str
    failed_stage: str | None = None
    processed_frames: int
    total_frames: int | None
    analysis_progress: int | None
    processing_started_at: datetime | None
    processing_completed_at: datetime | None
    result_ready: bool
    error_message: str | None = None


class VideoProgressUpdate(BaseModel):
    stage: str = Field(pattern="^(ANALYZING|RENDERING)$")
    processed_frames: int | None = Field(default=None, ge=0)
    total_frames: int | None = Field(default=None, ge=1)


class WebcamDetectionObjectResponse(BaseModel):
    label: str
    class_code: str | None = None
    class_name_ko: str | None = None
    group_code: str | None = None
    confidence: float
    bbox: DetectionBBoxResponse


class WebcamDetectionFrameResponse(BaseModel):
    media_width: int
    media_height: int
    inference_ms: float
    detected_objects: list[WebcamDetectionObjectResponse] = Field(default_factory=list)
