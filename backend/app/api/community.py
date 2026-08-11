from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path as ApiPath, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.config import BACKEND_DIR, get_settings
from app.core.security import utc_now
from app.db.session import get_db
from app.models import CommunityComment, CommunityPost, User
from app.schemas.community import CommunityCommentResponse, CommunityFeedResponse, CommunityPostResponse
from app.services.community import CATEGORIES, can_delete, can_edit_post, comment_response, get_comment, get_post, list_comments, list_feed, post_response
from app.services.image_uploads import remove_public_image, save_public_image

router = APIRouter(prefix="/api/community", tags=["community"])


def upload_root() -> Path:
    configured = Path(get_settings().UPLOAD_DIR)
    return configured if configured.is_absolute() else BACKEND_DIR / configured


def clean(value: str | None) -> str | None:
    result = value.strip() if value else ""
    return result or None


def validate_input(category: str, title: str, content: str, latitude: float | None, longitude: float | None) -> tuple[str, str, str]:
    normalized = category.strip().upper()
    if normalized not in CATEGORIES: raise HTTPException(status_code=422, detail="지원하지 않는 카테고리입니다.")
    title, content = title.strip(), content.strip()
    if not title or len(title) > 120 or not content or len(content) > 10000: raise HTTPException(status_code=422, detail="제목과 내용을 확인해 주세요.")
    if (latitude is None) != (longitude is None): raise HTTPException(status_code=422, detail="위도와 경도는 함께 입력해야 합니다.")
    return normalized, title, content


@router.get("/posts", response_model=CommunityFeedResponse)
def feed(db: Annotated[Session, Depends(get_db)], category: str | None = None, query: str | None = None, place: str | None = None, sort: Literal["latest", "comments"] = "latest", skip: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(ge=1, le=30)] = 15) -> CommunityFeedResponse:
    if category and category.upper() not in CATEGORIES: raise HTTPException(status_code=422, detail="지원하지 않는 카테고리입니다.")
    return list_feed(db, category=category.upper() if category else None, query=query, place=place, sort=sort, skip=skip, limit=limit)


@router.post("/posts", response_model=CommunityPostResponse, status_code=201)
async def create_post(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)], category: Annotated[str, Form()], title: Annotated[str, Form()], content: Annotated[str, Form()], place_name: Annotated[str | None, Form()] = None, address: Annotated[str | None, Form()] = None, latitude: Annotated[float | None, Form(ge=-90, le=90)] = None, longitude: Annotated[float | None, Form(ge=-180, le=180)] = None, is_notice: Annotated[bool, Form()] = False, image: Annotated[UploadFile | None, File()] = None) -> CommunityPostResponse:
    category, title, content = validate_input(category, title, content, latitude, longitude)
    if is_notice and current_user.role != "ADMIN": raise HTTPException(status_code=403, detail="공지 작성은 관리자만 가능합니다.")
    root = upload_root(); image_url = await save_public_image(image, root, folder="community")
    now = utc_now(); post = CommunityPost(user_id=current_user.id, category=category, title=title, content=content, place_name=clean(place_name), address=clean(address), latitude=latitude, longitude=longitude, image_url=image_url, is_notice=is_notice, created_at=now, updated_at=now)
    try: db.add(post); db.commit(); return post_response(get_post(db, post.id))
    except Exception: db.rollback(); remove_public_image(image_url, root); raise


@router.get("/posts/{id}", response_model=CommunityPostResponse)
def detail(id: Annotated[int, ApiPath(ge=1)], db: Annotated[Session, Depends(get_db)]) -> CommunityPostResponse:
    post = get_post(db, id)
    if post is None: raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    return post_response(post)


@router.patch("/posts/{id}", response_model=CommunityPostResponse)
async def update_post(id: Annotated[int, ApiPath(ge=1)], current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)], category: Annotated[str, Form()], title: Annotated[str, Form()], content: Annotated[str, Form()], place_name: Annotated[str | None, Form()] = None, address: Annotated[str | None, Form()] = None, latitude: Annotated[float | None, Form(ge=-90, le=90)] = None, longitude: Annotated[float | None, Form(ge=-180, le=180)] = None, is_notice: Annotated[bool, Form()] = False, remove_image: Annotated[bool, Form()] = False, image: Annotated[UploadFile | None, File()] = None) -> CommunityPostResponse:
    post = get_post(db, id)
    if post is None: raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    if not can_edit_post(current_user, post): raise HTTPException(status_code=403, detail="본인 게시글만 수정할 수 있습니다.")
    category, title, content = validate_input(category, title, content, latitude, longitude)
    if is_notice and current_user.role != "ADMIN": raise HTTPException(status_code=403, detail="공지 설정은 관리자만 가능합니다.")
    root = upload_root(); old_image = post.image_url; new_image = await save_public_image(image, root, folder="community")
    post.category, post.title, post.content, post.place_name, post.address, post.latitude, post.longitude, post.is_notice, post.updated_at = category, title, content, clean(place_name), clean(address), latitude, longitude, is_notice, utc_now()
    if new_image: post.image_url = new_image
    elif remove_image: post.image_url = None
    try: db.commit(); result = post_response(get_post(db, id))
    except Exception: db.rollback(); remove_public_image(new_image, root); raise
    if old_image and old_image != post.image_url: remove_public_image(old_image, root)
    return result


@router.delete("/posts/{id}", status_code=204)
def delete_post(id: Annotated[int, ApiPath(ge=1)], current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]) -> None:
    post = get_post(db, id)
    if post is None: raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    if not can_delete(current_user, post.user_id): raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    post.deleted_at = utc_now(); post.updated_at = utc_now(); db.commit()


@router.get("/posts/{id}/comments", response_model=list[CommunityCommentResponse])
def comments(id: Annotated[int, ApiPath(ge=1)], db: Annotated[Session, Depends(get_db)]) -> list[CommunityCommentResponse]:
    if get_post(db, id) is None: raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    return [comment_response(item) for item in list_comments(db, id)]


@router.post("/posts/{id}/comments", response_model=CommunityCommentResponse, status_code=201)
def create_comment(id: Annotated[int, ApiPath(ge=1)], current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)], content: Annotated[str, Form()]) -> CommunityCommentResponse:
    if get_post(db, id) is None: raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    content = content.strip()
    if not content or len(content) > 1000: raise HTTPException(status_code=422, detail="댓글 내용을 확인해 주세요.")
    now = utc_now(); item = CommunityComment(post_id=id, user_id=current_user.id, content=content, created_at=now, updated_at=now); db.add(item); db.commit(); db.refresh(item); return comment_response(get_comment(db, item.id))


@router.delete("/comments/{id}", status_code=204)
def delete_comment(id: Annotated[int, ApiPath(ge=1)], current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]) -> None:
    item = get_comment(db, id)
    if item is None: raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
    if not can_delete(current_user, item.user_id): raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    item.deleted_at = utc_now(); item.updated_at = utc_now(); db.commit()
