from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CopilotMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class CopilotContext(BaseModel):
    page: str = Field(default="UNKNOWN", max_length=60)
    path: str = Field(default="/", max_length=300)
    entity_id: int | None = Field(default=None, ge=1)


class CopilotRequest(BaseModel):
    messages: list[CopilotMessage] = Field(min_length=1, max_length=20)
    context: CopilotContext = Field(default_factory=CopilotContext)
    conversation_public_id: str | None = Field(default=None, max_length=36)
    client_message_id: str | None = Field(default=None, max_length=64)


class CopilotCard(BaseModel):
    type: Literal["MATCH", "ANALYSIS", "STATUS", "TIMELINE", "EVIDENCE", "SYSTEM_NOTICE"]
    title: str = Field(max_length=160)
    subtitle: str | None = Field(default=None, max_length=240)
    score: int | None = Field(default=None, ge=0, le=100)
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: str | None = Field(default=None, max_length=60)
    details: list[str] = Field(default_factory=list, max_length=8)
    entity_id: int | None = None


class CopilotAction(BaseModel):
    type: Literal["NAVIGATE", "ASK"]
    label: str = Field(max_length=80)
    target: str = Field(max_length=300)


class CopilotSuggestion(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=160)


class CopilotResponse(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    cards: list[CopilotCard] = Field(default_factory=list, max_length=5)
    actions: list[CopilotAction] = Field(default_factory=list, max_length=5)
    suggestions: list[CopilotSuggestion] = Field(default_factory=list, max_length=5)
    mode: Literal["GUIDE", "PERSONAL", "OPERATIONS"]
    provider: str
    model: str
    conversation_public_id: str | None = None


class CopilotConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class CopilotStoredMessage(BaseModel):
    id: int
    role: Literal["USER", "ASSISTANT"]
    content: str
    cards: list[CopilotCard] = Field(default_factory=list)
    actions: list[CopilotAction] = Field(default_factory=list)
    suggestions: list[CopilotSuggestion] = Field(default_factory=list)
    created_at: datetime


class CopilotConversationSummary(BaseModel):
    public_id: str
    title: str
    context_type: str
    context_entity_id: int | None
    last_message_at: datetime


class CopilotConversationDetail(CopilotConversationSummary):
    messages: list[CopilotStoredMessage]
