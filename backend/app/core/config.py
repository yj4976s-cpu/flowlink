from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://flowlink_user:password@127.0.0.1:5432/flowlink"
)
DEFAULT_JWT_SECRET_KEY = "change-this-secret-key"
DEFAULT_FRONTEND_URL = "http://localhost:3000"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    APP_ENV: str = "development"
    APP_HOST: str = "127.0.0.1"
    APP_PORT: int = 8000
    DATABASE_URL: str = DEFAULT_DATABASE_URL
    JWT_SECRET_KEY: str = DEFAULT_JWT_SECRET_KEY
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    AUTH_COOKIE_NAME: str = "flowlink_access_token"
    ROBOFLOW_API_KEY: str = ""
    ROBOFLOW_PROJECT_ID: str = ""
    ROBOFLOW_MODEL_VERSION: str = ""
    UPLOAD_DIR: str = "uploads"
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_STORAGE_BUCKET: str = ""
    FRONTEND_URL: str = DEFAULT_FRONTEND_URL
    KAKAO_REST_API_KEY: str = ""
    KAKAO_CLIENT_SECRET: str = ""
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""
    OAUTH_BACKEND_BASE_URL: str = "http://localhost:8000"
    AI_SERVICE_URL: str = "http://127.0.0.1:8001"
    AI_INTERNAL_API_KEY: str = ""
    AI_SERVICE_TIMEOUT_SECONDS: float = 30.0
    AI_VIDEO_SERVICE_TIMEOUT_SECONDS: float = 120.0
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
    COPILOT_MAX_OUTPUT_TOKENS: int = 1200
    COPILOT_PROVIDER_COOLDOWN_SECONDS: int = 30

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if not self._is_production:
            return self

        errors: list[str] = []
        jwt_secret = self.JWT_SECRET_KEY.strip()
        database_url = self.DATABASE_URL.strip()
        frontend_url = self.FRONTEND_URL.strip()
        parsed_frontend_url = urlparse(frontend_url)
        frontend_hostname = parsed_frontend_url.hostname
        ai_internal_api_key = self.AI_INTERNAL_API_KEY.strip()

        if len(jwt_secret) < 32 or jwt_secret == DEFAULT_JWT_SECRET_KEY:
            errors.append(
                "JWT_SECRET_KEY must be a non-default value with at least 32 characters"
            )
        if not database_url or database_url == DEFAULT_DATABASE_URL:
            errors.append("DATABASE_URL must be configured for the production database")
        if (
            not frontend_url
            or frontend_url == DEFAULT_FRONTEND_URL
            or parsed_frontend_url.scheme != "https"
            or not frontend_hostname
            or frontend_hostname.lower() == "localhost"
            or frontend_hostname.startswith("127.")
            or parsed_frontend_url.path not in {"", "/"}
            or bool(parsed_frontend_url.params)
            or bool(parsed_frontend_url.query)
            or bool(parsed_frontend_url.fragment)
        ):
            errors.append("FRONTEND_URL must be a valid HTTPS production origin")
        if len(ai_internal_api_key) < 32:
            errors.append(
                "AI_INTERNAL_API_KEY must be configured with at least 32 characters"
            )

        if errors:
            raise ValueError("Invalid production settings: " + "; ".join(errors))
        return self

    @property
    def _is_production(self) -> bool:
        return self.APP_ENV.lower() in {"production", "prod"}

    @property
    def auth_cookie_secure(self) -> bool:
        return self._is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()
