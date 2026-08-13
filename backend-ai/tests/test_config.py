import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_development_allows_local_defaults() -> None:
    settings = Settings(_env_file=None, APP_ENV="development")

    assert settings.APP_ENV == "development"


def test_production_requires_ai_internal_api_key() -> None:
    with pytest.raises(ValidationError, match="AI_INTERNAL_API_KEY"):
        Settings(_env_file=None, APP_ENV="production", AI_INTERNAL_API_KEY="")


def test_production_accepts_ai_internal_api_key() -> None:
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        AI_INTERNAL_API_KEY="flowlink-ai-internal-production-key-32",
    )

    assert settings.APP_ENV == "production"
