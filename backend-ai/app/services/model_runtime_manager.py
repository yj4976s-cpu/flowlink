from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from threading import Lock

from PIL import Image
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings
from app.schemas.runtime import RuntimeModelInfo, RuntimeModelStatusResponse, RuntimeModelSwitchResponse
from app.services.model_registry import (
    ModelRegistryDocument,
    ModelRegistryError,
    RegisteredModel,
    available_model_statuses,
    find_model_by_file_name,
    find_model_by_id,
    load_model_registry,
    normalize_model_label,
    registered_model_path,
)
from app.services.yolo_runtime import YoloRuntime, YoloRuntimeUnavailableError


class ModelRuntimeError(RuntimeError):
    status_code = 503
    code = "MODEL_SERVICE_UNAVAILABLE"


class ModelRuntimeNotFoundError(ModelRuntimeError):
    status_code = 404
    code = "MODEL_NOT_FOUND"


class ModelRuntimeValidationError(ModelRuntimeError):
    status_code = 422
    code = "MODEL_VALIDATION_FAILED"


class ModelRuntimeConflictError(ModelRuntimeError):
    status_code = 409
    code = "MODEL_SWITCH_CONFLICT"


class ActiveModelState(BaseModel):
    schema_version: int
    active_model_id: str
    previous_model_id: str | None = None
    switched_at: datetime


@dataclass(frozen=True)
class RuntimeSnapshot:
    model_id: str
    display_name: str
    classes: list[str]
    switched_at: datetime
    runtime: YoloRuntime


class ModelRuntimeManager:
    def __init__(self, *, state_path: Path | None = None, registry: ModelRegistryDocument | None = None) -> None:
        self._settings = get_settings()
        self._state_path = state_path or Path(self._settings.MODEL_STATE_PATH)
        self._registry = registry or load_model_registry()
        self._lock = Lock()
        self._switching = False
        self._snapshot: RuntimeSnapshot | None = None
        self._state_error = False
        self._previous_model_id: str | None = None
        self._request_cache: dict[str, RuntimeModelSwitchResponse] = {}
        self._restore_from_state()

    def status(self, *, verify_ready: bool = False) -> RuntimeModelStatusResponse:
        if verify_ready:
            self.get_snapshot()
        active_id = self._snapshot.model_id if self._snapshot is not None else None
        statuses = available_model_statuses(self._registry)
        return RuntimeModelStatusResponse(
            active_model_id=active_id,
            previous_model_id=self._previous_model_id,
            active_display_name=self._snapshot.display_name if self._snapshot else None,
            active_classes=list(self._snapshot.classes) if self._snapshot else [],
            switched_at=self._snapshot.switched_at if self._snapshot else None,
            model_ready=self._snapshot is not None and not self._state_error,
            switching=self._switching,
            available_models=[
                RuntimeModelInfo(
                    id=item.model.id,
                    display_name=item.model.display_name,
                    classes=list(item.model.expected_classes),
                    supports_hat=item.model.supports_hat,
                    available=item.available and item.model.enabled,
                    active=item.model.id == active_id,
                )
                for item in statuses
            ],
            rollback_available=self._previous_model_id is not None and find_model_by_id(self._previous_model_id, registry=self._registry) is not None,
        )

    def get_snapshot(self) -> RuntimeSnapshot:
        if self._state_error or self._snapshot is None:
            raise ModelRuntimeError("Model service is not ready")
        self._snapshot.runtime.validate_ready(expected_classes=self._snapshot.classes)
        return self._snapshot

    def activate(
        self,
        *,
        model_id: str,
        expected_active_model_id: str | None,
        request_id: str,
    ) -> RuntimeModelSwitchResponse:
        return self._switch(model_id=model_id, expected_active_model_id=expected_active_model_id, request_id=request_id)

    def rollback(self, *, expected_active_model_id: str | None, request_id: str) -> RuntimeModelSwitchResponse:
        if self._previous_model_id is None:
            raise ModelRuntimeConflictError("Rollback target is unavailable")
        return self._switch(model_id=self._previous_model_id, expected_active_model_id=expected_active_model_id, request_id=request_id)

    def _switch(
        self,
        *,
        model_id: str,
        expected_active_model_id: str | None,
        request_id: str,
    ) -> RuntimeModelSwitchResponse:
        if request_id in self._request_cache:
            return self._request_cache[request_id]
        with self._lock:
            if request_id in self._request_cache:
                return self._request_cache[request_id]
            if self._switching:
                raise ModelRuntimeConflictError("Another model switch is already running")
            active_id = self._snapshot.model_id if self._snapshot else None
            if expected_active_model_id is not None and expected_active_model_id != active_id:
                raise ModelRuntimeConflictError("Active model changed")
            if active_id == model_id and self._snapshot is not None:
                response = self._response(changed=False, previous_model_id=self._previous_model_id, snapshot=self._snapshot)
                self._remember_request(request_id, response)
                return response
            self._switching = True

        try:
            model = self._model_or_error(model_id)
            runtime = self._validated_runtime(model)
            now = datetime.now(UTC)
            previous_id = active_id
            snapshot = RuntimeSnapshot(
                model_id=model.id,
                display_name=model.display_name,
                classes=list(model.expected_classes),
                switched_at=now,
                runtime=runtime,
            )
            self._write_state(
                ActiveModelState(
                    schema_version=1,
                    active_model_id=model.id,
                    previous_model_id=previous_id,
                    switched_at=now,
                )
            )
            with self._lock:
                self._snapshot = snapshot
                self._previous_model_id = previous_id
                self._state_error = False
                response = self._response(changed=True, previous_model_id=previous_id, snapshot=snapshot)
                self._remember_request(request_id, response)
                return response
        finally:
            with self._lock:
                self._switching = False

    def _restore_from_state(self) -> None:
        try:
            state = self._read_state()
            if state is None:
                bootstrap = find_model_by_file_name(Path(self._settings.DETECTION_MODEL).name, registry=self._registry)
                if bootstrap is None:
                    self._state_error = True
                    return
                state = ActiveModelState(
                    schema_version=1,
                    active_model_id=bootstrap.id,
                    previous_model_id=None,
                    switched_at=datetime.now(UTC),
                )
            model = self._model_or_error(state.active_model_id)
            runtime = self._runtime_for(model)
            self._snapshot = RuntimeSnapshot(
                model_id=model.id,
                display_name=model.display_name,
                classes=list(model.expected_classes),
                switched_at=state.switched_at,
                runtime=runtime,
            )
            self._previous_model_id = state.previous_model_id
            self._state_error = False
        except ModelRuntimeError:
            self._state_error = True

    def _read_state(self) -> ActiveModelState | None:
        if not self._state_path.exists():
            return None
        try:
            return ActiveModelState.model_validate_json(self._state_path.read_text(encoding="utf-8"))
        except (OSError, ValidationError, ValueError) as exc:
            raise ModelRuntimeError("Model state is invalid") from exc

    def _write_state(self, state: ActiveModelState) -> None:
        try:
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self._state_path.with_name(f".{self._state_path.name}.tmp")
            temporary.write_text(state.model_dump_json(), encoding="utf-8")
            try:
                os.chmod(temporary, 0o600)
            except OSError:
                pass
            os.replace(temporary, self._state_path)
        except OSError as exc:
            raise ModelRuntimeError("Model state could not be saved") from exc

    def _model_or_error(self, model_id: str) -> RegisteredModel:
        model = find_model_by_id(model_id, registry=self._registry)
        if model is None or not model.enabled:
            raise ModelRuntimeNotFoundError("Model is not registered")
        path = registered_model_path(model)
        if not path.is_file():
            raise ModelRuntimeValidationError("Model file is unavailable")
        return model

    def _runtime_for(self, model: RegisteredModel) -> YoloRuntime:
        return YoloRuntime(
            model_path=str(registered_model_path(model)),
            confidence=self._settings.DETECTION_CONFIDENCE,
            imgsz=self._settings.DETECTION_IMGSZ,
            model_id=model.id,
            display_name=model.display_name,
            expected_classes=list(model.expected_classes),
        )

    def _validated_runtime(self, model: RegisteredModel) -> YoloRuntime:
        runtime = self._runtime_for(model)
        try:
            runtime.validate_ready(expected_classes=model.expected_classes)
        except YoloRuntimeUnavailableError as exc:
            raise ModelRuntimeValidationError("Model validation failed") from exc
        return runtime

    def _response(self, *, changed: bool, previous_model_id: str | None, snapshot: RuntimeSnapshot) -> RuntimeModelSwitchResponse:
        return RuntimeModelSwitchResponse(
            changed=changed,
            previous_model_id=previous_model_id,
            active_model_id=snapshot.model_id,
            active_classes=list(snapshot.classes),
            switched_at=snapshot.switched_at,
            model_ready=True,
        )

    def _remember_request(self, request_id: str, response: RuntimeModelSwitchResponse) -> None:
        self._request_cache[request_id] = response
        if len(self._request_cache) > 100:
            for key in list(self._request_cache)[:20]:
                self._request_cache.pop(key, None)


@lru_cache
def get_model_runtime_manager() -> ModelRuntimeManager:
    return ModelRuntimeManager()


def get_active_yolo_runtime_snapshot() -> RuntimeSnapshot:
    return get_model_runtime_manager().get_snapshot()


def validate_model_classes(model_names: dict[int, str] | list[str] | tuple[str, ...], expected_classes: list[str]) -> bool:
    values = model_names.values() if isinstance(model_names, dict) else model_names
    actual = {normalized for label in values if (normalized := normalize_model_label(str(label))) is not None}
    return actual == set(expected_classes)
