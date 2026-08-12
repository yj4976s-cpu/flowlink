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
    AI_SERVICE_URL: str = "http://127.0.0.1:8001"
    AI_INTERNAL_API_KEY: str = ""
    AI_SERVICE_TIMEOUT_SECONDS: float = 30.0
    CHAT_MODEL_PROVIDER: str = "gemini"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.6-flash"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    COPILOT_TIMEOUT_SECONDS: float = 30.0
    COPILOT_RATE_LIMIT_WINDOW_SECONDS: int = 60
    COPILOT_GUEST_RATE_LIMIT: int = 10
    COPILOT_USER_RATE_LIMIT: int = 30
    COPILOT_ADMIN_RATE_LIMIT: int = 60

    @property
    def auth_cookie_secure(self) -> bool:
        return self.APP_ENV.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
