from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_settings


settings = get_settings()

engine_options: dict[str, object] = {"pool_pre_ping": True}
if not settings._is_production:
    # Local development often shares Supabase's small session-pool allowance
    # with deployed services. Do not retain idle database connections locally.
    engine_options["poolclass"] = NullPool
if ":6543/" in settings.DATABASE_URL:
    # Supabase transaction pooling does not support prepared statements.
    engine_options["connect_args"] = {"prepare_threshold": None}

engine = create_engine(settings.DATABASE_URL, **engine_options)

SessionLocal = sessionmaker(
    bind=engine,
    class_=Session,
    autoflush=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """SQLAlchemy 모델의 공통 기본 클래스."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI 요청마다 DB 세션을 생성하고 종료합니다."""

    db = SessionLocal()

    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def check_database_connection() -> bool:
    """PostgreSQL 연결 가능 여부를 확인합니다."""

    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1"))
        return result.scalar_one() == 1
