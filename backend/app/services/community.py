from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal, NamedTuple

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.security import utc_now
from app.models import CommunityComment, CommunityPost, DetectedObject, FoundItem, User
from app.schemas.community import CommunityCommentResponse, CommunityContextResponse, CommunityFeedResponse, CommunityPostResponse, CommunitySystemUpdate
from app.services.found_item_images import representative_found_item_image_url

CATEGORIES = {"FIELD_STORY", "QUESTION", "EXPERIENCE", "OPINION"}


class FeedEntry(NamedTuple):
    kind: Literal["post", "system"]
    timestamp: datetime
    id: int
    item: CommunityPost | FoundItem


def _timeline_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def post_response(post: CommunityPost) -> CommunityPostResponse:
    count = sum(1 for item in post.comments if item.deleted_at is None)
    return CommunityPostResponse(id=post.id, user_id=post.user_id, nickname=post.user.nickname, category=post.category, title=post.title, content=post.content, place_name=post.place_name, address=post.address, latitude=float(post.latitude) if post.latitude is not None else None, longitude=float(post.longitude) if post.longitude is not None else None, image_url=post.image_url, is_notice=post.is_notice, comment_count=count, created_at=post.created_at, updated_at=post.updated_at)


def comment_response(comment: CommunityComment) -> CommunityCommentResponse:
    return CommunityCommentResponse(id=comment.id, parent_comment_id=comment.parent_comment_id, user_id=comment.user_id, nickname=comment.user.nickname, content=comment.content, created_at=comment.created_at)


def get_post(db: Session, post_id: int) -> CommunityPost | None:
    return db.scalar(select(CommunityPost).options(joinedload(CommunityPost.user), selectinload(CommunityPost.comments).joinedload(CommunityComment.user)).where(CommunityPost.id == post_id, CommunityPost.deleted_at.is_(None)))


def get_comment(db: Session, comment_id: int) -> CommunityComment | None:
    return db.scalar(select(CommunityComment).options(joinedload(CommunityComment.user)).where(CommunityComment.id == comment_id, CommunityComment.deleted_at.is_(None)))


def list_comments(db: Session, post_id: int) -> list[CommunityComment]:
    return list(db.scalars(select(CommunityComment).options(joinedload(CommunityComment.user)).where(CommunityComment.post_id == post_id, CommunityComment.deleted_at.is_(None)).order_by(CommunityComment.created_at.asc())).all())


def soft_delete_comment_thread(db: Session, comment: CommunityComment) -> None:
    deleted_at = utc_now()
    comment.deleted_at = deleted_at
    comment.updated_at = deleted_at
    if comment.parent_comment_id is not None:
        return

    replies = list(db.scalars(select(CommunityComment).where(CommunityComment.parent_comment_id == comment.id, CommunityComment.deleted_at.is_(None))).all())
    for reply in replies:
        reply.deleted_at = deleted_at
        reply.updated_at = deleted_at


def _filtered_posts_statement(*, category: str | None, query: str | None, place: str | None):
    statement = select(CommunityPost).where(CommunityPost.deleted_at.is_(None))
    if category:
        statement = statement.where(CommunityPost.category == category)
    if query:
        pattern = f"%{query.strip()}%"
        statement = statement.where(or_(CommunityPost.title.ilike(pattern), CommunityPost.content.ilike(pattern), CommunityPost.place_name.ilike(pattern)))
    if place:
        pattern = f"%{place.strip()}%"
        statement = statement.where(or_(CommunityPost.place_name.ilike(pattern), CommunityPost.address.ilike(pattern)))
    return statement


def list_feed(db: Session, *, category: str | None, query: str | None, place: str | None, sort: str, skip: int, limit: int) -> CommunityFeedResponse:
    statement = _filtered_posts_statement(category=category, query=query, place=place)
    regular_statement = statement.options(joinedload(CommunityPost.user), selectinload(CommunityPost.comments).joinedload(CommunityComment.user)).where(CommunityPost.is_notice.is_(False))
    regular_posts = list(db.scalars(regular_statement.order_by(CommunityPost.created_at.desc())).unique().all())
    notices = []
    if skip == 0:
        notice_statement = statement.options(joinedload(CommunityPost.user), selectinload(CommunityPost.comments).joinedload(CommunityComment.user)).where(CommunityPost.is_notice.is_(True))
        notices = list(db.scalars(notice_statement.order_by(CommunityPost.created_at.desc()).limit(5)).unique().all())

    now = utc_now()
    today = _timeline_timestamp(now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0))
    found_items: list[FoundItem] = []
    if category is None:
        item_statement = select(FoundItem).options(joinedload(FoundItem.object_class), joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event), selectinload(FoundItem.citizen_reports)).where(FoundItem.is_public.is_(True), FoundItem.status.in_(("AVAILABLE", "RECOVERED", "RETURNED")))
        if place: item_statement = item_statement.where(FoundItem.area_name.ilike(f"%{place.strip()}%"))
        found_items = list(db.scalars(item_statement.order_by(FoundItem.updated_at.desc())).all())
    entries = [
        *[FeedEntry("post", _timeline_timestamp(item.created_at), item.id, item) for item in regular_posts],
        *[FeedEntry("system", _timeline_timestamp(item.updated_at if item.status == "RETURNED" else item.created_at), item.id, item) for item in found_items],
    ]
    entries.sort(key=lambda entry: (entry.timestamp, entry.id), reverse=True)
    total = len(entries)
    page_entries = entries[skip:skip + limit]
    posts = [entry.item for entry in page_entries if entry.kind == "post" and isinstance(entry.item, CommunityPost)]
    page_found_items = [entry.item for entry in page_entries if entry.kind == "system" and isinstance(entry.item, FoundItem)]
    has_more = skip + len(page_entries) < total
    updates = [CommunitySystemUpdate(type="RETURN_UPDATE" if item.status == "RETURNED" else "FOUND_ITEM_UPDATE", id=item.id, title=f"발견된 {item.object_class.name_ko}이(가) 주인에게 반환됐어요" if item.status == "RETURNED" else f"{item.object_class.name_ko} 발견물이 새로 등록됐어요", place_name=item.area_name, latitude=float(item.latitude) if item.latitude is not None else None, longitude=float(item.longitude) if item.longitude is not None else None, image_url=representative_found_item_image_url(item), timestamp=item.updated_at if item.status == "RETURNED" else item.created_at, href=f"/found-items/{item.id}" if item.status != "RETURNED" else None) for item in page_found_items]
    today_posts = int(db.scalar(select(func.count(CommunityPost.id)).where(CommunityPost.deleted_at.is_(None), CommunityPost.created_at >= today, CommunityPost.place_name.ilike(f"%{place.strip()}%") if place else True)) or 0)
    found_count = sum(1 for item in found_items if _timeline_timestamp(item.created_at) >= today and item.status != "RETURNED")
    return_count = sum(1 for item in found_items if _timeline_timestamp(item.updated_at) >= today and item.status == "RETURNED")
    return CommunityFeedResponse(notices=[post_response(item) for item in notices], posts=[post_response(item) for item in posts], system_updates=updates, context=CommunityContextResponse(found_items=found_count, new_stories=today_posts, returns=return_count), total=total, has_more=has_more)


def can_edit_post(user: User, post: CommunityPost) -> bool:
    return user.id == post.user_id


def can_delete(user: User, owner_id: int) -> bool:
    return user.id == owner_id or user.role == "ADMIN"
