from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.security import require_internal_api_key
from app.schemas.inference import ImageInferenceResponse
from app.services.inference import ImageInferenceService, InferenceModelUnavailableError, get_inference_service

router = APIRouter(prefix="/api/inference", tags=["inference"])


@router.post("/images", response_model=ImageInferenceResponse, summary="이미지 YOLO 추론")
async def infer_image(
    _: Annotated[None, Depends(require_internal_api_key)],
    service: Annotated[ImageInferenceService, Depends(get_inference_service)],
    file: Annotated[UploadFile, File(description="추론할 이미지")],
) -> ImageInferenceResponse:
    payload = await file.read(get_settings().IMAGE_MAX_BYTES + 1)
    try:
        return await run_in_threadpool(
            service.analyze_image_bytes,
            payload,
            content_type=file.content_type or "",
        )
    except InferenceModelUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI model is unavailable") from exc

