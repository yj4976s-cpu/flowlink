from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RuntimeModelInfo(BaseModel):
    id: str
    display_name: str
    classes: list[str]
    supports_hat: bool
    available: bool
    active: bool


class RuntimeModelStatusResponse(BaseModel):
    active_model_id: str | None = None
    previous_model_id: str | None = None
    active_display_name: str | None = None
    active_classes: list[str] = Field(default_factory=list)
    switched_at: datetime | None = None
    model_ready: bool
    switching: bool
    available_models: list[RuntimeModelInfo]
    rollback_available: bool


class RuntimeModelSwitchRequest(BaseModel):
    model_id: str
    expected_active_model_id: str | None = None
    request_id: str = Field(min_length=8, max_length=120)


class RuntimeModelRollbackRequest(BaseModel):
    expected_active_model_id: str | None = None
    request_id: str = Field(min_length=8, max_length=120)


class RuntimeModelSwitchResponse(BaseModel):
    changed: bool
    previous_model_id: str | None = None
    active_model_id: str
    active_classes: list[str]
    switched_at: datetime
    model_ready: bool
