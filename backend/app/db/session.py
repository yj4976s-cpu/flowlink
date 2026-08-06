from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


settings = get_settings()

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
)

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
    finally:
        db.close()


def check_database_connection() -> bool:
    """PostgreSQL 연결 가능 여부를 확인합니다."""

    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1"))
        return result.scalar_one() == 1