from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_AI_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_AI_DIR.parent
DEFAULT_DETECTION_MODEL = "yolo11n.pt"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_AI_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    APP_ENV: str = "development"
    APP_HOST: str = "127.0.0.1"
    APP_PORT: int = 8001
    AI_INTERNAL_API_KEY: str = ""
    BACKEND_INTERNAL_URL: str = "http://127.0.0.1:8000"
    DETECTION_MODEL: str = DEFAULT_DETECTION_MODEL
    DETECTION_CONFIDENCE: float = 0.25
    DETECTION_IMGSZ: int = 640
    IMAGE_MAX_BYTES: int = 20 * 1024 * 1024
    IMAGE_MAX_PIXELS: int = 16_000_000
    VIDEO_MAX_BYTES: int = 100 * 1024 * 1024
    VIDEO_MAX_DURATION_SECONDS: int = 30
    MODEL_STATE_PATH: str = "/app/state/active-model.json"

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.APP_ENV.lower() not in {"production", "prod"}:
            return self

        errors: list[str] = []
        detection_model = self.DETECTION_MODEL.strip()

        if len(self.AI_INTERNAL_API_KEY.strip()) < 32:
            errors.append(
                "AI_INTERNAL_API_KEY must be configured with at least 32 characters"
            )
        if not detection_model or detection_model == DEFAULT_DETECTION_MODEL:
            errors.append("DETECTION_MODEL must point to the production custom model")

        if errors:
            raise ValueError("Invalid production settings: " + "; ".join(errors))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
