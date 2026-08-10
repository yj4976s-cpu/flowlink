from __future__ import annotations

from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Path as ApiPath, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models import User
from app.repositories.detections import get_user_detection_event, list_user_detection_events
from app.schemas.detection import DetectionEventResponse
from app.services.detection_inference import DetectionInferenceService, get_inference_service
from app.services.detections import (
    DetectionModelUnavailableError,
    create_user_detection_event,
    process_detection_event,
)
from app.services.mappers import detection_event_response

router = APIRouter(prefix="/api/detections", tags=["detections"])

BACKEND_DIR = Path(__file__).resolve().parents[2]
IMAGE_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
VIDEO_CONTENT_TYPES = {"video/mp4": ".mp4"}
IMAGE_MAX_BYTES = 20 * 1024 * 1024
VIDEO_MAX_BYTES = 100 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024


def resolve_upload_root() -> Path:
    configured = Path(get_settings().UPLOAD_DIR)
    root = configured if configured.is_absolute() else BACKEND_DIR / configured
    return root.resolve()


async def save_upload_file(
    upload: UploadFile,
    *,
    current_user: User,
    allowed_types: dict[str, str],
    max_bytes: int,
) -> tuple[Path, str]:
    content_type = upload.content_type or ""
    suffix = allowed_types.get(content_type)
    if suffix is None:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported media type")

    upload_root = resolve_upload_root()
    relative_key = Path("detections") / "user" / str(current_user.id) / f"{uuid4().hex}{suffix}"
    destination = (upload_root / relative_key).resolve()
    if not destination.is_relative_to(upload_root):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload path")

    destination.parent.mkdir(parents=True, exist_ok=True)
    total_bytes = 0

    try:
        with destination.open("wb") as output:
            while chunk := await upload.read(UPLOAD_CHUNK_BYTES):
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded file is too large")
                output.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    return destination, relative_key.as_posix()


def get_latest_user_event_or_404(db: Session, *, event_id: int, user_id: int) -> DetectionEventResponse:
    event = get_user_detection_event(db, event_id=event_id, user_id=user_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection event not found")
    return detection_event_response(event)


@router.post("/images", response_model=DetectionEventResponse, status_code=201, summary="이미지 AI 탐지")
async def detect_image(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    inference_service: Annotated[DetectionInferenceService, Depends(get_inference_service)],
    file: Annotated[UploadFile, File(description="탐지할 이미지")],
) -> DetectionEventResponse:
    media_path, media_key = await save_upload_file(
        file,
        current_user=current_user,
        allowed_types=IMAGE_CONTENT_TYPES,
        max_bytes=IMAGE_MAX_BYTES,
    )
    try:
        event = create_user_detection_event(db, current_user=current_user, source_type="IMAGE", media_key=media_key)
    except Exception:
        media_path.unlink(missing_ok=True)
        raise
    try:
        process_detection_event(db, event_id=event.id, media_path=media_path, inference_service=inference_service)
    except DetectionModelUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AI detection could not be completed") from exc
    return get_latest_user_event_or_404(db, event_id=event.id, user_id=current_user.id)


@router.post("/videos", response_model=DetectionEventResponse, status_code=201, summary="영상 AI 탐지")
async def detect_video(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    inference_service: Annotated[DetectionInferenceService, Depends(get_inference_service)],
    file: Annotated[UploadFile, File(description="탐지할 영상")],
) -> DetectionEventResponse:
    media_path, media_key = await save_upload_file(
        file,
        current_user=current_user,
        allowed_types=VIDEO_CONTENT_TYPES,
        max_bytes=VIDEO_MAX_BYTES,
    )
    try:
        event = create_user_detection_event(db, current_user=current_user, source_type="VIDEO", media_key=media_key)
    except Exception:
        media_path.unlink(missing_ok=True)
        raise
    try:
        process_detection_event(db, event_id=event.id, media_path=media_path, inference_service=inference_service)
    except DetectionModelUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AI detection could not be completed") from exc
    return get_latest_user_event_or_404(db, event_id=event.id, user_id=current_user.id)


@router.get("/me", response_model=list[DetectionEventResponse], summary="내 AI 탐지 기록 조회")
def list_my_detections(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[DetectionEventResponse]:
    events = list_user_detection_events(db, user_id=current_user.id, skip=skip, limit=limit)
    return [detection_event_response(event) for event in events]


@router.get("/{id}", response_model=DetectionEventResponse, summary="내 AI 탐지 상세 조회")
def get_detection(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    id: Annotated[int, ApiPath(ge=1)],
) -> DetectionEventResponse:
    return get_latest_user_event_or_404(db, event_id=id, user_id=current_user.id)
