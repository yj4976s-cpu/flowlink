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


class ImageInferenceResponse(BaseModel):
    media_width: int
    media_height: int
    inference_ms: float = Field(ge=0)
    predictions: list[InferencePrediction] = Field(default_factory=list)

