from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import LostReport, ObjectClass, User
from app.services.copilot_memory import conversation_count, detail, get_or_create, model_history, rename, save_message, soft_delete, soft_delete_all, summaries, validated_context


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


def test_entity_context_requires_the_authenticated_owner(db: Session) -> None:
    owner = user(db, 1, "owner@example.com")
    stranger = user(db, 2, "stranger@example.com")
    now = datetime.now(timezone.utc)
    object_class = ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now)
    db.add(object_class)
    db.flush()
    report = LostReport(user_id=owner.id, object_class_id=object_class.id, description="검정 가방", area_name="잠실역", lost_from=now, status="OPEN", created_at=now, updated_at=now)
    db.add(report)
    db.commit()

    assert validated_context(db, owner, "LOST_REPORT_DETAIL", report.id) == ("LOST_REPORT", report.id)
    assert validated_context(db, stranger, "LOST_REPORT_DETAIL", report.id) == ("GENERAL", None)


def test_soft_delete_all_only_affects_current_user(db: Session) -> None:
    owner = user(db, 1, "owner@example.com")
    stranger = user(db, 2, "stranger@example.com")
    first = get_or_create(db, owner, None, "첫 대화", "GENERAL", None)
    second = get_or_create(db, owner, None, "둘째 대화", "GENERAL", None)
    foreign = get_or_create(db, stranger, None, "다른 사용자 대화", "GENERAL", None)
    db.commit()

    assert conversation_count(db, owner) == 2
    assert soft_delete_all(db, owner) == 2
    assert conversation_count(db, owner) == 0
    db.refresh(first)
    assert first.deleted_at is not None
    assert first.updated_at == first.deleted_at
    assert detail(db, owner, first.public_id) is None
    assert detail(db, owner, second.public_id) is None
    assert detail(db, stranger, foreign.public_id) is not None
    assert conversation_count(db, stranger) == 1


def test_conversation_count_and_pages_cover_more_than_one_hundred_rows(db: Session) -> None:
    owner = user(db, 1, "owner@example.com")
    for index in range(101):
        get_or_create(db, owner, None, f"대화 {index}", "GENERAL", None)
    db.commit()

    first_page = summaries(db, owner, 0, 100)
    second_page = summaries(db, owner, 100, 100)

    assert conversation_count(db, owner) == 101
    assert len(first_page) == 100
    assert len(second_page) == 1
    assert {item.public_id for item in first_page}.isdisjoint({item.public_id for item in second_page})
