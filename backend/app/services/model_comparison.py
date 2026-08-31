from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.schemas.admin import AdminModelComparisonResponse

MODEL_COMPARISON_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "model_comparison.json"


class ModelComparisonDataError(RuntimeError):
    pass


def load_model_comparison(path: Path = MODEL_COMPARISON_DATA_PATH) -> AdminModelComparisonResponse:
    try:
        raw = path.read_text(encoding="utf-8")
        payload: Any = json.loads(raw)
        return AdminModelComparisonResponse.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        raise ModelComparisonDataError("Model comparison data is unavailable") from exc
