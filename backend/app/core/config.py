from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    APP_ENV: str = "development"
    APP_HOST: str = "127.0.0.1"
    APP_PORT: int = 8000
    DATABASE_URL: str = "postgresql+psycopg://flowlink_user:password@127.0.0.1:5432/flowlink"
    JWT_SECRET_KEY: str = "change-this-secret-key"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    AUTH_COOKIE_NAME: str = "flowlink_access_token"
    ROBOFLOW_API_KEY: str = ""
    ROBOFLOW_PROJECT_ID: str = ""
    ROBOFLOW_MODEL_VERSION: str = ""
    UPLOAD_DIR: str = "uploads"
    FRONTEND_URL: str = "http://localhost:3000"
    DETECTION_MODEL: str = "yolo11n.pt"
    DETECTION_CONFIDENCE: float = 0.25
    DETECTION_IMGSZ: int = 640

    @property
    def auth_cookie_secure(self) -> bool:
        return self.APP_ENV.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
