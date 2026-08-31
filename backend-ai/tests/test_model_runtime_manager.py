from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.services.model_registry import ModelRegistryDocument, ModelRegistryError, RegisteredModel, load_model_registry, normalize_model_label, registered_model_path
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


def test_registry_rejects_absolute_model_paths() -> None:
    with pytest.raises(ValidationError):
        RegisteredModel(
            id="absolute",
            display_name="absolute",
            file_name="/tmp/model.pt",
            expected_classes=["BALL"],
        )


def test_registered_model_path_uses_backend_ai_models_first(tmp_path) -> None:
    model = RegisteredModel(id="old", display_name="old", file_name="old.pt", expected_classes=["BALL"])
    backend_ai_models = tmp_path / "backend-ai" / "models"
    repo_models = tmp_path / "models"
    backend_ai_models.mkdir(parents=True)
    repo_models.mkdir(parents=True)
    (backend_ai_models / "old.pt").write_bytes(b"backend-ai")
    (repo_models / "old.pt").write_bytes(b"repo")

    assert registered_model_path(model, model_dirs=(backend_ai_models, repo_models)) == backend_ai_models / "old.pt"


def test_registered_model_path_falls_back_to_repo_models(tmp_path) -> None:
    model = RegisteredModel(id="new", display_name="new", file_name="new.pt", expected_classes=["BALL"])
    backend_ai_models = tmp_path / "backend-ai" / "models"
    repo_models = tmp_path / "models"
    backend_ai_models.mkdir(parents=True)
    repo_models.mkdir(parents=True)
    (repo_models / "new.pt").write_bytes(b"repo")

    assert registered_model_path(model, model_dirs=(backend_ai_models, repo_models)) == repo_models / "new.pt"


def test_registered_model_path_returns_safe_candidate_when_missing(tmp_path) -> None:
    model = RegisteredModel(id="missing", display_name="missing", file_name="missing.pt", expected_classes=["BALL"])
    backend_ai_models = tmp_path / "backend-ai" / "models"
    repo_models = tmp_path / "models"
    backend_ai_models.mkdir(parents=True)
    repo_models.mkdir(parents=True)

    resolved = registered_model_path(model, model_dirs=(backend_ai_models, repo_models))

    assert resolved == backend_ai_models / "missing.pt"
    assert not resolved.exists()


def test_validate_model_classes_uses_names_not_class_order() -> None:
    assert validate_model_classes({0: "trash", 1: "hat", 2: "shoe", 3: "ball"}, ["BALL", "HAT", "FOOTWEAR", "TRASH"])
    assert not validate_model_classes({0: "ball", 1: "shoe", 2: "trash"}, ["BALL", "HAT", "FOOTWEAR", "TRASH"])
    assert not validate_model_classes({0: "ball", 1: "shoe", 2: "trash", 3: "bottle"}, ["BALL", "FOOTWEAR", "TRASH"])
    assert not validate_model_classes({0: "ball", 1: "shoe", 2: "trash", 3: "hat"}, ["BALL", "FOOTWEAR", "TRASH"])
    assert not validate_model_classes({0: "ball", 1: "shoe", 2: "footwear", 3: "trash"}, ["BALL", "FOOTWEAR", "TRASH"])
    assert not validate_model_classes({}, ["BALL", "FOOTWEAR", "TRASH"])


def test_registered_model_rejects_duplicate_expected_aliases() -> None:
    with pytest.raises(ValidationError):
        RegisteredModel(
            id="duplicate",
            display_name="duplicate",
            file_name="duplicate.pt",
            expected_classes=["BALL", "shoe", "FOOTWEAR"],
        )


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


def test_status_is_not_ready_until_runtime_validation_runs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    runtime = FakeRuntime(model_id="flowlink-3class-v6-7")
    monkeypatch.setattr("app.services.model_runtime_manager.ModelRuntimeManager._runtime_for", lambda self, model: runtime)
    manager = ModelRuntimeManager(state_path=tmp_path / "active-model.json", registry=registry())

    assert manager.status().model_ready is False
    assert manager.status(verify_ready=True).model_ready is True
    assert runtime.validations == 1


def test_malformed_registry_returns_safe_unready_status(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_registry():
        raise ModelRegistryError("contains /secret/model.pt")

    monkeypatch.setattr("app.services.model_runtime_manager.load_model_registry", fail_registry)
    manager = ModelRuntimeManager(state_path=tmp_path / "active-model.json")

    status = manager.status()
    assert status.active_model_id is None
    assert status.available_models == []
    assert status.model_ready is False
    with pytest.raises(Exception) as raised:
        manager.get_snapshot()
    assert "secret" not in str(raised.value)


def test_state_write_failure_preserves_previous_snapshot_and_state(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    monkeypatch.setattr("app.services.model_runtime_manager.ModelRuntimeManager._runtime_for", lambda self, model: FakeRuntime(model_id=model.id))
    state_path = tmp_path / "active-model.json"
    manager = ModelRuntimeManager(state_path=state_path, registry=registry())
    before = state_path.read_text(encoding="utf-8") if state_path.exists() else None

    def fail_write(self, state):
        raise OSError("disk path /secret failed")

    monkeypatch.setattr("app.services.model_runtime_manager.ModelRuntimeManager._write_state", fail_write)
    with pytest.raises(Exception):
        manager.activate(model_id="flowlink-4class-hat-v7", expected_active_model_id="flowlink-3class-v6-7", request_id="request-write-fail")

    assert manager.status().active_model_id == "flowlink-3class-v6-7"
    if before is None:
        assert not state_path.exists()
    else:
        assert state_path.read_text(encoding="utf-8") == before


def test_corrupt_state_file_fails_readiness(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_files(tmp_path, monkeypatch)
    state_path = tmp_path / "active-model.json"
    state_path.write_text("{not json", encoding="utf-8")

    manager = ModelRuntimeManager(state_path=state_path, registry=registry())

    assert manager.status().model_ready is False


def test_yolo_runtime_rejects_invalid_warmup_result(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from app.services.yolo_runtime import YoloRuntime, YoloRuntimeUnavailableError

    class FakeModel:
        names = {0: "ball", 1: "shoe", 2: "trash"}

        def predict(self, **kwargs):
            return []

    runtime = YoloRuntime(model_path=str(tmp_path / "model.pt"), confidence=0.25, imgsz=640, expected_classes=["BALL", "FOOTWEAR", "TRASH"])
    monkeypatch.setattr(runtime, "_get_model", lambda: FakeModel())

    with pytest.raises(YoloRuntimeUnavailableError):
        runtime.validate_ready()


def test_yolo_runtime_rejects_unexpected_model_classes(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from app.services.yolo_runtime import YoloRuntime, YoloRuntimeUnavailableError

    class FakeResult:
        boxes = []

    class FakeModel:
        names = {0: "ball", 1: "shoe", 2: "trash", 3: "bottle"}

        def predict(self, **kwargs):
            return [FakeResult()]

    runtime = YoloRuntime(model_path=str(tmp_path / "model.pt"), confidence=0.25, imgsz=640, expected_classes=["BALL", "FOOTWEAR", "TRASH"])
    monkeypatch.setattr(runtime, "_get_model", lambda: FakeModel())

    with pytest.raises(YoloRuntimeUnavailableError):
        runtime.validate_ready()
