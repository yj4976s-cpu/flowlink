import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings

BACKEND_AI_DIR = Path(__file__).resolve().parents[1]


def test_development_allows_local_defaults() -> None:
    settings = Settings(_env_file=None, APP_ENV="development")

    assert settings.APP_ENV == "development"


def test_production_requires_ai_internal_api_key() -> None:
    with pytest.raises(ValidationError, match="AI_INTERNAL_API_KEY"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            AI_INTERNAL_API_KEY="",
            DETECTION_MODEL="models/custom.pt",
        )


def test_production_rejects_default_detection_model() -> None:
    with pytest.raises(ValidationError, match="DETECTION_MODEL"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            AI_INTERNAL_API_KEY="flowlink-ai-internal-production-key-32",
            DETECTION_MODEL="yolo11n.pt",
        )


def test_production_requires_detection_model() -> None:
    with pytest.raises(ValidationError, match="DETECTION_MODEL"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            AI_INTERNAL_API_KEY="flowlink-ai-internal-production-key-32",
            DETECTION_MODEL="",
        )


def test_production_accepts_ai_internal_api_key() -> None:
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        AI_INTERNAL_API_KEY="flowlink-ai-internal-production-key-32",
        DETECTION_MODEL="models/custom.pt",
    )

    assert settings.APP_ENV == "production"


def test_main_import_fails_fast_with_invalid_production_config() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "production",
            "AI_INTERNAL_API_KEY": "",
            "DETECTION_MODEL": "models/custom.pt",
        }
    )

    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        cwd=BACKEND_AI_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "AI_INTERNAL_API_KEY" in result.stderr


def test_main_import_accepts_valid_production_config() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "production",
            "AI_INTERNAL_API_KEY": "flowlink-ai-internal-production-key-32",
            "DETECTION_MODEL": "models/custom.pt",
        }
    )

    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        cwd=BACKEND_AI_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
