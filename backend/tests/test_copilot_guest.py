import asyncio
from collections.abc import Iterator
from unittest.mock import Mock

import pytest
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import utc_now
from app.db.session import Base
from app.models import CommunityPost, User
from app.schemas.copilot import CopilotRequest
from app.services.copilot import create_copilot_response


@compiles(BigInteger, "sqlite")
def compile_big_integer_for_sqlite(_type, _compiler, **_kwargs) -> str:
    return "INTEGER"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    with factory() as session:
        yield session


def request(message: str) -> CopilotRequest:
    return CopilotRequest.model_validate({"messages": [{"role": "user", "content": message}], "context": {"page": "HOME", "path": "/"}})


def seed_post(db: Session, *, category: str, title: str, content: str = "사용자가 공유한 참고 정보입니다.") -> CommunityPost:
    now = utc_now()
    user = User(
        id=100,
        email="guest-community@example.com",
        password_hash="unused",
        nickname="커뮤니티 사용자",
        role="USER",
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
    )
    post = CommunityPost(
        id=200 if category == "FIELD_STORY" else 201,
        user_id=user.id,
        category=category,
        title=title,
        content=content,
        created_at=now,
        updated_at=now,
    )
    db.add_all([user, post])
    db.commit()
    return post


def provider_should_not_run(monkeypatch: pytest.MonkeyPatch) -> Mock:
    provider = Mock(side_effect=AssertionError("guest copilot must not call chat provider"))
    monkeypatch.setattr("app.services.copilot.create_chat_provider", provider)
    return provider


def test_guest_greeting_does_not_call_provider(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    provider = provider_should_not_run(monkeypatch)
    response = asyncio.run(create_copilot_response(db, request("안녕"), None))
    assert provider.call_count == 0
    assert response.provider == "flowlink"
    assert response.mode == "GUIDE"
    assert any(action.target == "/found-items" for action in response.actions)


def test_guest_lost_report_guide_does_not_call_provider(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    provider = provider_should_not_run(monkeypatch)
    response = asyncio.run(create_copilot_response(db, request("분실 신고는 어떻게 해?"), None))
    assert provider.call_count == 0
    assert "로그인" in response.message
    assert any(action.target == "/login" for action in response.actions)


def test_guest_recent_field_story_uses_db_without_provider(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_post(db, category="FIELD_STORY", title="최근 목격 제보")
    provider = provider_should_not_run(monkeypatch)
    response = asyncio.run(create_copilot_response(db, request("최근 목격 제보 있어?"), None))
    assert provider.call_count == 0
    assert [card.type for card in response.cards] == ["COMMUNITY"]
    assert response.cards[0].title == "최근 목격 제보"


def test_guest_recent_opinion_uses_db_without_provider(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_post(db, category="OPINION", title="최근 자유 이야기")
    provider = provider_should_not_run(monkeypatch)
    response = asyncio.run(create_copilot_response(db, request("최근 자유 이야기 보여줘"), None))
    assert provider.call_count == 0
    assert [card.type for card in response.cards] == ["COMMUNITY"]
    assert response.cards[0].title == "최근 자유 이야기"
    assert "공식 발견물" in response.message
