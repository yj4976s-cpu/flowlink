from pydantic import BaseModel, Field


class InferenceBBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class InferencePrediction(BaseModel):
    label: str
    confidence: float
    bbox: InferenceBBox


class InferenceVideoTrack(BaseModel):
    label: str
    confidence: float
    bbox: InferenceBBox
    track_id: int | None
    first_seen_ms: int
    last_seen_ms: int
    appearance_count: int = Field(ge=1)


class ImageInferenceResponse(BaseModel):
    media_width: int
    media_height: int
    inference_ms: float = Field(ge=0)
    predictions: list[InferencePrediction] = Field(default_factory=list)


class VideoInferenceResponse(BaseModel):
    media_width: int
    media_height: int
    duration_ms: int = Field(ge=0)
    frame_count: int = Field(ge=1)
    fps: float = Field(gt=0)
    inference_ms: float = Field(ge=0)
    tracks: list[InferenceVideoTrack] = Field(default_factory=list)
