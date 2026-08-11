from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import User
from app.services.copilot_memory import detail, get_or_create, model_history, rename, save_message, soft_delete, summaries


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    Base.metadata.drop_all(engine)


def user(db: Session, user_id: int, email: str) -> User:
    now = datetime.now(timezone.utc)
    row = User(id=user_id, email=email, password_hash="x", nickname=email, role="USER", active=True,
               terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now)
    db.add(row); db.commit(); return row


def test_lazy_create_restore_and_presentation(db: Session) -> None:
    owner = user(db, 1, "owner@example.com")
    conversation = get_or_create(db, owner, None, "내 매칭을 확인해줘", "GENERAL", None)
    first = save_message(db, conversation, "USER", "내 매칭을 확인해줘", client_id="client-1")
    assert save_message(db, conversation, "USER", "중복", client_id="client-1").id == first.id
    save_message(db, conversation, "ASSISTANT", "확인했어요", presentation={"cards": [{"type": "MATCH", "title": "가방", "details": [], "entity_id": 7}], "actions": [], "suggestions": []})
    db.commit()

    restored = detail(db, owner, conversation.public_id)
    assert restored and [message.role for message in restored.messages] == ["USER", "ASSISTANT"]
    assert restored.messages[1].cards[0].entity_id == 7
    assert len(model_history(db, conversation)) == 2


def test_owner_scope_rename_order_and_soft_delete(db: Session) -> None:
    owner = user(db, 1, "owner@example.com")
    stranger = user(db, 2, "stranger@example.com")
    conversation = get_or_create(db, owner, None, "원래 제목", "GENERAL", None); db.commit()

    assert detail(db, stranger, conversation.public_id) is None
    assert rename(db, stranger, conversation.public_id, "침범") is None
    assert rename(db, owner, conversation.public_id, "바뀐 제목").title == "바뀐 제목"
    assert summaries(db, owner, 0, 15)[0].title == "바뀐 제목"
    assert not soft_delete(db, stranger, conversation.public_id)
    assert soft_delete(db, owner, conversation.public_id)
    assert detail(db, owner, conversation.public_id) is None
    assert summaries(db, owner, 0, 15) == []
