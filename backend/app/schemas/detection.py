from datetime import datetime

from typing import Literal

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
    original_media_bytes: int | None = None
    result_media_url: str | None
    result_media_bytes: int | None = None
    ai_model_id: str | None = None
    media_width: int | None
    media_height: int | None
    created_at: datetime
    processing_started_at: datetime | None
    processing_completed_at: datetime | None
    detected_objects: list[DetectionObjectResponse] = Field(default_factory=list)


class DetectionEventListResponse(DetectionEventResponse):
    pass


class DetectionImagePolicyResponse(BaseModel):
    allowed_content_types: list[str]
    source_max_bytes: int = Field(ge=0)
    source_max_pixels: int = Field(ge=0)
    normalized_max_edge: int = Field(ge=0)
    normalized_target_bytes: int = Field(ge=0)
    normalized_hard_max_bytes: int = Field(ge=0)


class DetectionVideoPolicyResponse(BaseModel):
    allowed_content_types: list[str]
    max_bytes: int = Field(ge=0)
    max_duration_seconds: int = Field(ge=0)
    max_source_edge: int = Field(ge=0)
    normalized_max_width: int = Field(ge=0)
    normalized_max_height: int = Field(ge=0)
    normalized_max_fps: int = Field(ge=0)


class DetectionQuotaPolicyResponse(BaseModel):
    image_count_last_24h: int = Field(ge=0)
    video_count_last_24h: int = Field(ge=0)
    media_storage_bytes: int = Field(ge=0)
    active_video_jobs: int = Field(ge=0)


class DetectionUploadPolicyResponse(BaseModel):
    image: DetectionImagePolicyResponse
    video: DetectionVideoPolicyResponse
    quota: DetectionQuotaPolicyResponse


class DetectionStorageUsageResponse(BaseModel):
    used_bytes: int
    limit_bytes: int
    usage_ratio: float
    remaining_bytes: int
    image_count_last_24h: int
    image_limit_last_24h: int
    video_count_last_24h: int
    video_limit_last_24h: int
    active_video_jobs: int
    active_video_job_limit: int
    has_unknown_legacy_usage: bool


class DetectionClassDistributionItem(BaseModel):
    class_code: str
    class_name_ko: str
    count: int
    ratio: float


class DetectionConfidenceDistributionItem(BaseModel):
    code: Literal["GE_90", "GE_70", "GE_50", "LT_50"]
    label: str
    count: int
    ratio: float


class DetectionDailyTrendItem(BaseModel):
    date: str
    analysis_count: int
    object_count: int


class DetectionRecentEventSummary(BaseModel):
    id: int
    source_type: str
    status: str
    created_at: datetime
    processing_completed_at: datetime | None
    object_count: int
    primary_class_code: str | None
    primary_class_name_ko: str | None
    average_confidence: float | None


class DetectionAnalysisSummaryResponse(BaseModel):
    period_days: Literal[7, 30, 90]
    period_start: datetime
    period_end: datetime
    generated_at: datetime
    total_analyses: int
    completed_count: int
    failed_count: int
    in_progress_count: int
    completion_rate: float
    image_count: int
    video_count: int
    total_detected_objects: int
    average_confidence: float | None
    class_distribution: list[DetectionClassDistributionItem]
    confidence_distribution: list[DetectionConfidenceDistributionItem]
    daily_trend: list[DetectionDailyTrendItem]
    recent_events: list[DetectionRecentEventSummary]


class VideoDetectionAcceptedResponse(BaseModel):
    detection_event_id: int
    video_job_id: int
    status: str
    stage: str


class VideoProcessingStatusResponse(BaseModel):
    detection_event_id: int
    video_job_id: int
    status: str
    stage: str = Field(pattern="^(QUEUED|NORMALIZING|ANALYZING|RENDERING|SAVING|COMPLETED|FAILED)$")
    failed_stage: str | None = Field(default=None, pattern="^(QUEUED|NORMALIZING|ANALYZING|RENDERING|SAVING)$")
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
