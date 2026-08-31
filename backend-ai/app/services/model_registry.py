from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError, model_validator

from app.core.config import BACKEND_AI_DIR

MODEL_REGISTRY_PATH = BACKEND_AI_DIR / "app" / "data" / "model_registry.json"
MODEL_DIR = BACKEND_AI_DIR / "models"
ALLOWED_MODEL_SUFFIXES = {".pt"}
LABEL_ALIASES = {
    "ball": "BALL",
    "sports ball": "BALL",
    "footwear": "FOOTWEAR",
    "shoe": "FOOTWEAR",
    "shoes": "FOOTWEAR",
    "sneaker": "FOOTWEAR",
    "trash": "TRASH",
    "waste": "TRASH",
    "hat": "HAT",
    "cap": "HAT",
}


class ModelRegistryError(RuntimeError):
    pass


class RegisteredModel(BaseModel):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    display_name: str
    file_name: str
    expected_classes: list[str] = Field(min_length=1)
    architecture: str | None = None
    supports_hat: bool = False
    enabled: bool = True

    @model_validator(mode="after")
    def validate_file_name(self) -> "RegisteredModel":
        path = Path(self.file_name)
        if path.name != self.file_name or path.suffix.lower() not in ALLOWED_MODEL_SUFFIXES:
            raise ValueError("model file name is not allowed")
        normalized = [normalize_model_label(item) for item in self.expected_classes]
        if any(item is None for item in normalized):
            raise ValueError("expected classes contain an unknown class")
        self.expected_classes = [item for item in normalized if item is not None]
        return self


class ModelRegistryDocument(BaseModel):
    schema_version: int
    models: list[RegisteredModel] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ModelRegistryDocument":
        ids = [model.id for model in self.models]
        if len(ids) != len(set(ids)):
            raise ValueError("model ids must be unique")
        return self


@dataclass(frozen=True)
class ModelFileStatus:
    model: RegisteredModel
    path: Path
    available: bool


def normalize_model_label(label: str) -> str | None:
    normalized = label.strip().lower().replace("_", " ").replace("-", " ")
    direct = normalized.upper().replace(" ", "_")
    if direct in {"BALL", "FOOTWEAR", "TRASH", "HAT"}:
        return direct
    return LABEL_ALIASES.get(normalized)


def load_model_registry(path: Path = MODEL_REGISTRY_PATH) -> ModelRegistryDocument:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return ModelRegistryDocument.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise ModelRegistryError("Model registry is unavailable") from exc


def registered_model_path(model: RegisteredModel, *, model_dir: Path = MODEL_DIR) -> Path:
    root = model_dir.resolve()
    candidate = (root / model.file_name).resolve()
    if root != candidate.parent:
        raise ModelRegistryError("Model registry contains an invalid model path")
    return candidate


def find_model_by_id(model_id: str, *, registry: ModelRegistryDocument | None = None) -> RegisteredModel | None:
    document = registry or load_model_registry()
    return next((model for model in document.models if model.id == model_id), None)


def find_model_by_file_name(file_name: str, *, registry: ModelRegistryDocument | None = None) -> RegisteredModel | None:
    document = registry or load_model_registry()
    safe_name = Path(file_name).name
    return next((model for model in document.models if model.file_name == safe_name), None)


def available_model_statuses(registry: ModelRegistryDocument) -> list[ModelFileStatus]:
    return [
        ModelFileStatus(model=model, path=registered_model_path(model), available=registered_model_path(model).is_file())
        for model in registry.models
    ]
