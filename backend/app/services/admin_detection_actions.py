from __future__ import annotations

from datetime import UTC

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import DetectedObject, FoundItem, ProcessingHistory, User
from app.repositories.user_flow import get_detected_object_by_id, waste_collection_completed_ids
from app.services.admin_notifications import sync_detected_object_follow_up_notifications
from app.services.matching import create_match_candidates_for_found_item

PERSONAL_ITEM_GROUP = "PERSONAL_ITEM"
WASTE_GROUP = "WASTE"


def effective_group(item: DetectedObject) -> str:
    return (item.final_class or item.object_class).group_code


def create_ai_found_item(db: Session, *, admin: User, detected_object_id: int) -> FoundItem:
    item = get_detected_object_by_id(db, detected_object_id, for_update=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detected object not found")
    if item.detection_event.purpose != "OPERATION":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User analysis detections cannot create found items")
    if item.processing_status != "CONFIRMED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Detected object review is not confirmed")
    final_class = item.final_class or item.object_class
    if final_class.group_code != PERSONAL_ITEM_GROUP:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only personal items can become found items")
    if item.found_item is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Found item already exists")
    camera = item.detection_event.camera
    if camera is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Camera location is required")

    now = utc_now()
    found_item = FoundItem(
        detected_object_id=item.id,
        object_class_id=final_class.id,
        registered_by=admin.id,
        source_type="AI",
        color=item.confirmed_color or item.ai_color,
        area_name=camera.area_name,
        latitude=camera.latitude,
        longitude=camera.longitude,
        found_at=item.detected_at if item.detected_at.tzinfo is not None else item.detected_at.replace(tzinfo=UTC),
        status="AVAILABLE",
        is_public=True,
        admin_memo=item.admin_memo,
        created_at=now,
        updated_at=now,
    )
    try:
        db.add(found_item)
        db.flush()
        db.add(ProcessingHistory(
            actor_user_id=admin.id,
            entity_type="DETECTED_OBJECT",
            entity_id=item.id,
            action_type="DETECTED_OBJECT_FOUND_ITEM_CREATED",
            previous_status=item.processing_status,
            new_status=item.processing_status,
            note=f"found_item_id={found_item.id}",
            created_at=now,
        ))
        create_match_candidates_for_found_item(db, found_item)
        sync_detected_object_follow_up_notifications(db, item)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Found item already exists") from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(found_item)
    return found_item


def complete_waste_collection(db: Session, *, admin: User, detected_object_id: int) -> DetectedObject:
    item = get_detected_object_by_id(db, detected_object_id, for_update=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detected object not found")
    if item.detection_event.purpose != "OPERATION":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User analysis detections cannot be collected")
    if item.processing_status != "CONFIRMED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Detected object review is not confirmed")
    if effective_group(item) != WASTE_GROUP:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only waste can be collected")
    if item.id in waste_collection_completed_ids(db, [item.id]):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Waste collection already completed")
    db.add(ProcessingHistory(
        actor_user_id=admin.id,
        entity_type="DETECTED_OBJECT",
        entity_id=item.id,
        action_type="WASTE_COLLECTION_COMPLETED",
        previous_status=item.processing_status,
        new_status=item.processing_status,
        note=None,
        created_at=utc_now(),
    ))
    sync_detected_object_follow_up_notifications(db, item)
    db.commit()
    return item
