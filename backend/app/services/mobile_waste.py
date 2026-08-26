from __future__ import annotations

import math
from datetime import UTC
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Camera, DetectedObject, DetectionEvent, ProcessingHistory, User
from app.repositories.detections import OPERATION_PURPOSE, get_active_object_class_by_code
from app.services.detection_inference import (
    DetectionBBox,
    DetectionInferenceService,
    DetectionInferenceUnavailableError,
    DetectionPrediction,
    bbox_iou,
)
from app.services.detections import SAFE_MODEL_UNAVAILABLE_MESSAGE, utc_now

TRASH_CODE = "TRASH"
WASTE_GROUP = "WASTE"
MOBILE_WASTE_IOU_THRESHOLD = 0.5
MOBILE_WASTE_NOTE = "모바일 현장 카메라에서 폐기물 회수 대상으로 등록"


def _assign_sqlite_id(db: Session, instance: DetectionEvent | DetectedObject) -> None:
    """Fill BigInteger primary keys only for SQLite contract tests.

    PostgreSQL keeps using its normal sequence/default behavior in production.
    """
    bind = db.get_bind()
    if bind.dialect.name != "sqlite" or instance.id is not None:
        return

    model = type(instance)
    next_id = (db.scalar(select(func.coalesce(func.max(model.id), 0))) or 0) + 1
    instance.id = int(next_id)


def _ensure_valid_bbox(bbox: DetectionBBox, *, media_width: int, media_height: int) -> None:
    values = (bbox.x, bbox.y, bbox.width, bbox.height)
    if not all(math.isfinite(value) for value in values):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="유효한 Bounding Box를 선택해 주세요.",
        )
    if bbox.width <= 0 or bbox.height <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="유효한 Bounding Box를 선택해 주세요.",
        )
    if bbox.x < 0 or bbox.y < 0 or bbox.x + bbox.width > media_width or bbox.y + bbox.height > media_height:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="선택한 Bounding Box가 이미지 범위를 벗어났습니다.",
        )


def _find_matching_trash(
    predictions: list[DetectionPrediction],
    selected_bbox: DetectionBBox,
) -> DetectionPrediction:
    trash_predictions = [
        prediction
        for prediction in predictions
        if prediction.class_code.strip().upper() == TRASH_CODE
    ]
    if not trash_predictions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="선택 가능한 폐기물 탐지 결과가 없습니다.",
        )

    scored = sorted(
        ((bbox_iou(selected_bbox, prediction.bbox), prediction) for prediction in trash_predictions),
        key=lambda item: item[0],
        reverse=True,
    )
    best_iou, best_prediction = scored[0]
    if best_iou < MOBILE_WASTE_IOU_THRESHOLD:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="선택한 영역과 서버 폐기물 탐지 결과가 일치하지 않습니다. 다시 선택해 주세요.",
        )
    return best_prediction


def _save_crop(media_path: Path, prediction: DetectionPrediction, *, media_width: int, media_height: int) -> tuple[Path, str]:
    _ensure_valid_bbox(prediction.bbox, media_width=media_width, media_height=media_height)
    left = max(0, min(media_width, int(math.floor(prediction.bbox.x))))
    top = max(0, min(media_height, int(math.floor(prediction.bbox.y))))
    right = max(left, min(media_width, int(math.ceil(prediction.bbox.x + prediction.bbox.width))))
    bottom = max(top, min(media_height, int(math.ceil(prediction.bbox.y + prediction.bbox.height))))
    if right <= left or bottom <= top:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="폐기물 crop 이미지를 만들 수 없는 영역입니다.",
        )

    crop_path = media_path.with_name(f"{media_path.stem}-crop.jpg")
    try:
        with Image.open(media_path) as source:
            crop = source.convert("RGB").crop((left, top, right, bottom))
            crop.save(crop_path, format="JPEG", quality=88)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        crop_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="폐기물 crop 이미지를 저장하지 못했습니다.",
        ) from exc

    return crop_path, crop_path.relative_to(media_path.parents[3]).as_posix()


def register_mobile_waste_candidate(
    db: Session,
    *,
    admin: User,
    camera: Camera,
    media_path: Path,
    media_key: str,
    selected_bbox: DetectionBBox,
    inference_service: DetectionInferenceService,
) -> DetectedObject:
    crop_path: Path | None = None
    try:
        try:
            result = inference_service.analyze_image(media_path)
        except DetectionInferenceUnavailableError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=SAFE_MODEL_UNAVAILABLE_MESSAGE,
            ) from exc

        if not result.media_width or not result.media_height:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="이미지 크기를 확인하지 못했습니다.",
            )
        _ensure_valid_bbox(selected_bbox, media_width=result.media_width, media_height=result.media_height)

        trash_class = get_active_object_class_by_code(db, TRASH_CODE)
        if trash_class is None or trash_class.group_code != WASTE_GROUP:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="폐기물 클래스 설정을 확인해 주세요.",
            )

        selected_prediction = _find_matching_trash(result.detections, selected_bbox)
        crop_path, crop_key = _save_crop(
            media_path,
            selected_prediction,
            media_width=result.media_width,
            media_height=result.media_height,
        )

        now = utc_now()
        event = DetectionEvent(
            user_id=admin.id,
            camera_id=camera.id,
            purpose=OPERATION_PURPOSE,
            source_type="IMAGE",
            original_media_url=media_key,
            media_width=result.media_width,
            media_height=result.media_height,
            status="COMPLETED",
            captured_at=now,
            processing_started_at=now,
            processing_completed_at=now,
            created_at=now,
            updated_at=now,
        )
        _assign_sqlite_id(db, event)
        db.add(event)
        db.flush()

        detected_object = DetectedObject(
            detection_event_id=event.id,
            object_class_id=trash_class.id,
            final_class_code=TRASH_CODE,
            processing_status="CONFIRMED",
            admin_memo=MOBILE_WASTE_NOTE,
            confidence=Decimal(str(selected_prediction.confidence)),
            bbox_x=Decimal(str(selected_prediction.bbox.x)),
            bbox_y=Decimal(str(selected_prediction.bbox.y)),
            bbox_width=Decimal(str(selected_prediction.bbox.width)),
            bbox_height=Decimal(str(selected_prediction.bbox.height)),
            cropped_image_url=crop_key,
            appearance_count=1,
            detected_at=now,
            created_at=now,
        )
        _assign_sqlite_id(db, detected_object)
        db.add(detected_object)
        db.flush()
        db.add(ProcessingHistory(
            actor_user_id=admin.id,
            entity_type="DETECTED_OBJECT",
            entity_id=detected_object.id,
            action_type="DETECTED_OBJECT_REVIEWED",
            previous_status="PENDING",
            new_status="CONFIRMED",
            note=MOBILE_WASTE_NOTE,
            created_at=now if now.tzinfo is not None else now.replace(tzinfo=UTC),
        ))
        db.commit()
        db.refresh(detected_object)
        return detected_object
    except Exception:
        db.rollback()
        if crop_path is not None:
            crop_path.unlink(missing_ok=True)
        media_path.unlink(missing_ok=True)
        raise
