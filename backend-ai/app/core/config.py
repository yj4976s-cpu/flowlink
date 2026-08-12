from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_AI_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_AI_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_AI_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    APP_ENV: str = "development"
    APP_HOST: str = "127.0.0.1"
    APP_PORT: int = 8001
    AI_INTERNAL_API_KEY: str = ""
    DETECTION_MODEL: str = "yolo11n.pt"
    DETECTION_CONFIDENCE: float = 0.25
    DETECTION_IMGSZ: int = 640
    IMAGE_MAX_BYTES: int = 20 * 1024 * 1024
    IMAGE_MAX_PIXELS: int = 16_000_000
    VIDEO_MAX_BYTES: int = 100 * 1024 * 1024
    VIDEO_MAX_DURATION_SECONDS: int = 30


@lru_cache
def get_settings() -> Settings:
    return Settings()
