from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.auth import get_current_user
from app.core.security import utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import User


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


def user(db: Session, user_id: int, role: str = "USER") -> User:
    now = utc_now(); item = User(id=user_id, email=f"community{user_id}@example.com", password_hash="unused", nickname=f"작성자{user_id}", role=role, active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now); db.add(item); db.commit(); return item


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: (yield db)
    with TestClient(app) as value: yield value
    app.dependency_overrides.clear()


def as_user(current: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: current


def post(client: TestClient, **values):
    payload = {"category": "FIELD_STORY", "title": "한강 산책로 이야기", "content": "오후에 물이 많이 올라왔어요.", **values}
    return client.post("/api/community/posts", data=payload)


def test_create_list_detail_and_optional_location(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    created = post(client)
    assert created.status_code == 201 and created.json()["place_name"] is None
    listing = client.get("/api/community/posts")
    assert listing.status_code == 200 and listing.json()["posts"][0]["title"] == "한강 산책로 이야기"
    assert client.get(f"/api/community/posts/{created.json()['id']}").status_code == 200


def test_user_cannot_create_notice_but_admin_can(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    assert post(client, is_notice="true").status_code == 403
    as_user(user(db, 2, "ADMIN"))
    response = post(client, is_notice="true")
    assert response.status_code == 201 and response.json()["is_notice"] is True


def test_post_and_comment_owner_permissions(client: TestClient, db: Session) -> None:
    owner = user(db, 1); other = user(db, 2); admin = user(db, 3, "ADMIN")
    as_user(owner); created = post(client).json(); post_id = created["id"]
    comment = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "좋은 정보 감사합니다."})
    assert comment.status_code == 201
    as_user(other)
    assert client.patch(f"/api/community/posts/{post_id}", data={"category": "QUESTION", "title": "수정 시도", "content": "수정할 수 없어야 합니다."}).status_code == 403
    assert client.delete(f"/api/community/comments/{comment.json()['id']}").status_code == 403
    as_user(admin)
    assert client.delete(f"/api/community/comments/{comment.json()['id']}").status_code == 204
    assert client.delete(f"/api/community/posts/{post_id}").status_code == 204
    assert client.get(f"/api/community/posts/{post_id}").status_code == 404
