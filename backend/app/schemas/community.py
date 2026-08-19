from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CommunityPostInput(BaseModel):
    category: str
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=10000)
    place_name: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_notice: bool = False


class CommunityCommentInput(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    parent_comment_id: int | None = None


class CommunityCommentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    parent_comment_id: int | None
    user_id: int
    nickname: str
    content: str
    created_at: datetime


class CommunityPostResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    nickname: str
    category: str
    title: str
    content: str
    place_name: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    image_url: str | None
    is_notice: bool
    comment_count: int
    created_at: datetime
    updated_at: datetime


class CommunitySystemUpdate(BaseModel):
    type: str
    id: int
    title: str
    place_name: str
    latitude: float | None
    longitude: float | None
    timestamp: datetime
    href: str | None


class CommunityContextResponse(BaseModel):
    found_items: int
    new_stories: int
    returns: int


class CommunityFeedResponse(BaseModel):
    notices: list[CommunityPostResponse]
    posts: list[CommunityPostResponse]
    system_updates: list[CommunitySystemUpdate]
    context: CommunityContextResponse
    total: int
    has_more: bool
