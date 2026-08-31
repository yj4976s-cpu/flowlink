from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.services.model_registry import ModelRegistryDocument, RegisteredModel, load_model_registry, normalize_model_label
from app.services.model_runtime_manager import (
    ActiveModelState,
    ModelRuntimeConflictError,
    ModelRuntimeManager,
    ModelRuntimeNotFoundError,
    ModelRuntimeValidationError,
    validate_model_classes,
)


def registry() -> ModelRegistryDocument:
    return ModelRegistryDocument(
        schema_version=1,
        models=[
            RegisteredModel(
                id="flowlink-3class-v6-7",
                display_name="기존 3클래스 모델",
                file_name="old.pt",
                expected_classes=["BALL", "FOOTWEAR", "TRASH"],
                supports_hat=False,
            ),
            RegisteredModel(
                id="flowlink-4class-hat-v7",
                display_name="신규 HAT 4클래스 모델",
                file_name="new.pt",
                expected_classes=["BALL", "HAT", "FOOTWEAR", "TRASH"],
                supports_hat=True,
            ),
        ],
    )


class FakeRuntime:
    def __init__(self, *, model_id: str, fail: bool = False) -> None:
        self.model_id = model_id
        self.fail = fail
        self.validations = 0

    def validate_ready(self, *, expected_classes=None) -> None:
        self.validations += 1
        if self.fail:
            from app.services.yolo_runtime import YoloRuntimeUnavailableError

            raise YoloRuntimeUnavailableError("boom")


def model_files(tmp_path, monkeypatch: pytest.MonkeyPatch):
    files = {"old.pt": tmp_path / "old.pt", "new.pt": tmp_path / "new.pt"}
    for path in files.values():
        path.write_bytes(b"model")
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "DETECTION_MODEL", "old.pt")
    monkeypatch.setattr("app.services.model_runtime_manager.registered_model_path", lambda model: files[model.file_name])
    monkeypatch.setattr("app.services.model_registry.registered_model_path", lambda model: files[model.file_name])
    return files


def test_registry_ids_match_model_comparison_json() -> None:
    backend_registry = load_model_registry()
    with open("../backend/app/data/model_comparison.json", encoding="utf-8") as handle:
        comparison_ids = {model["id"] for model in json.load(handle)["models"]}

    assert {model.id for model in backend_registry.models} == comparison_ids


def test_model_label_normalization_keeps_hat_and_footwear_aliases() -> None:
    assert normalize_model_label("hat") == "HAT"
    assert normalize_model_label("shoe") == "FOOTWEAR"
    assert normalize_model_label("sports_ball") == "BALL"
    assert normalize_model_label("unknown") is None


def test_registry_rejects_path_traversal() -> None:
    with pytest.raises(ValidationError):
        RegisteredModel(
            id="bad",
            display_name="bad",
            file_name="../secret.pt",
            expected_classes=["BALL"],
        )


def test_validate_model_classes_uses_names_not_class_order() -> None:
    assert validate_model_classes({0: "trash", 1: "hat", 2: "shoe", 3: "ball"}, ["BALL", "HAT", "FOOTWEAR", "TRASH"])
    assert not validate_model_classes({0: "ball", 1: "shoe", 2: "trash"}, ["BALL", "HAT", "FOOTWEAR", "TRASH"])


def test_activate_switches_after_validation_and_persists_state(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    monkeypatch.setattr("app.services.model_runtime_manager.ModelRuntimeManager._runtime_for", lambda self, model: FakeRuntime(model_id=model.id))
    manager = ModelRuntimeManager(state_path=tmp_path / "active-model.json", registry=registry())

    response = manager.activate(
        model_id="flowlink-4class-hat-v7",
        expected_active_model_id="flowlink-3class-v6-7",
        request_id="request-1",
    )

    assert response.changed is True
    assert response.previous_model_id == "flowlink-3class-v6-7"
    assert response.active_model_id == "flowlink-4class-hat-v7"
    assert manager.status().active_model_id == "flowlink-4class-hat-v7"
    assert ActiveModelState.model_validate_json((tmp_path / "active-model.json").read_text()).active_model_id == "flowlink-4class-hat-v7"


def test_same_request_id_is_idempotent(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    monkeypatch.setattr("app.services.model_runtime_manager.ModelRuntimeManager._runtime_for", lambda self, model: FakeRuntime(model_id=model.id))
    manager = ModelRuntimeManager(state_path=tmp_path / "active-model.json", registry=registry())

    first = manager.activate(model_id="flowlink-4class-hat-v7", expected_active_model_id="flowlink-3class-v6-7", request_id="request-2")
    second = manager.activate(model_id="flowlink-4class-hat-v7", expected_active_model_id="stale", request_id="request-2")

    assert first == second


def test_stale_expected_active_model_rejects_switch(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    monkeypatch.setattr("app.services.model_runtime_manager.ModelRuntimeManager._runtime_for", lambda self, model: FakeRuntime(model_id=model.id))
    manager = ModelRuntimeManager(state_path=tmp_path / "active-model.json", registry=registry())

    with pytest.raises(ModelRuntimeConflictError):
        manager.activate(model_id="flowlink-4class-hat-v7", expected_active_model_id="other", request_id="request-3")


def test_unknown_model_id_is_rejected(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    manager = ModelRuntimeManager(state_path=tmp_path / "active-model.json", registry=registry())

    with pytest.raises(ModelRuntimeNotFoundError):
        manager.activate(model_id="missing", expected_active_model_id="flowlink-3class-v6-7", request_id="request-4")


def test_validation_failure_keeps_current_model(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    monkeypatch.setattr("app.services.model_runtime_manager.ModelRuntimeManager._runtime_for", lambda self, model: FakeRuntime(model_id=model.id, fail=model.id.endswith("v7")))
    manager = ModelRuntimeManager(state_path=tmp_path / "active-model.json", registry=registry())

    with pytest.raises(ModelRuntimeValidationError):
        manager.activate(model_id="flowlink-4class-hat-v7", expected_active_model_id="flowlink-3class-v6-7", request_id="request-5")

    assert manager.status().active_model_id == "flowlink-3class-v6-7"


def test_corrupt_state_file_fails_readiness(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    state_path = tmp_path / "active-model.json"
    state_path.write_text("{not json", encoding="utf-8")

    manager = ModelRuntimeManager(state_path=state_path, registry=registry())

    assert manager.status().model_ready is False
