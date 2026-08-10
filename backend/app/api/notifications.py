from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.core.auth import require_user
from app.core.security import utc_now
from app.db.session import get_db
from app.models import User
from app.repositories.user_flow import get_notification_for_user, list_notifications_for_user
from app.schemas.notification import NotificationResponse
from app.services.mappers import notification_response

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationResponse], summary="내 알림 목록 조회")
def list_my_notifications(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    unread_only: bool = False,
) -> list[NotificationResponse]:
    notifications = list_notifications_for_user(
        db,
        current_user.id,
        skip=skip,
        limit=limit,
        unread_only=unread_only,
    )
    return [notification_response(notification) for notification in notifications]


@router.patch("/{id}/read", response_model=NotificationResponse, summary="내 알림 읽음 처리")
def mark_notification_as_read(
    id: Annotated[int, Path(ge=1)],
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
) -> NotificationResponse:
    notification = get_notification_for_user(db, id, current_user.id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if notification.read_at is None:
        notification.read_at = utc_now()
        db.commit()
        db.refresh(notification)
    return notification_response(notification)
