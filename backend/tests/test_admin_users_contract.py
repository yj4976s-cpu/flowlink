from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password
from app.db.session import Base, get_db
from app.main import app
from app.models import CommunityComment, CommunityPost, User


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    with factory() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def add_user(
    db: Session,
    *,
    user_id: int,
    email: str,
    nickname: str,
    role: str = "USER",
    active: bool = True,
    created_at: datetime,
    deleted_at: datetime | None = None,
) -> None:
    db.add(
        User(
            id=user_id,
            email=email,
            password_hash=hash_password("password123"),
            nickname=nickname,
            role=role,
            active=active,
            terms_agreed_at=created_at,
            privacy_agreed_at=created_at,
            last_login_at=created_at if active else None,
            deleted_at=deleted_at,
            created_at=created_at,
            updated_at=created_at,
        )
    )
    db.commit()


def login(client: TestClient, email: str) -> None:
    assert client.post("/api/auth/login", json={"email": email, "password": "password123"}).status_code == 200


def seed_users(db: Session) -> None:
    now = datetime.now(tz=UTC)
    add_user(db, user_id=1, email="admin@example.com", nickname="관리자", role="ADMIN", created_at=now)
    add_user(db, user_id=2, email="user@example.com", nickname="활성 사용자", created_at=now - timedelta(days=1))
    add_user(db, user_id=3, email="inactive@example.com", nickname="휴면 사용자", active=False, created_at=now - timedelta(days=2))
    add_user(db, user_id=4, email="deleted@example.com", nickname="삭제 사용자", active=False, created_at=now - timedelta(days=8), deleted_at=now - timedelta(days=1))


def test_admin_users_requires_admin(client: TestClient, db: Session) -> None:
    seed_users(db)
    assert client.get("/api/admin/users").status_code == 401
    login(client, "user@example.com")
    assert client.get("/api/admin/users").status_code == 403


def test_admin_users_returns_safe_summary_breakdowns_and_users(client: TestClient, db: Session) -> None:
    seed_users(db)
    login(client, "admin@example.com")

    response = client.get("/api/admin/users")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["total"] == 4
    assert body["summary"]["active"] == 2
    assert body["summary"]["inactive"] == 1
    assert body["summary"]["admins"] == 1
    assert body["summary"]["users"] == 2
    assert body["summary"]["deleted"] == 1
    assert body["summary"]["new_last_7_days"] == 3
    assert body["role_breakdown"] == [{"role": "ADMIN", "count": 1}, {"role": "USER", "count": 2}]
    assert body["status_breakdown"] == [
        {"status": "ACTIVE", "count": 2},
        {"status": "INACTIVE", "count": 1},
        {"status": "DELETED", "count": 1},
    ]
    assert len(body["signup_trend"]) == 7
    assert body["total"] == 3
    assert {item["email"] for item in body["users"]} == {"admin@example.com", "user@example.com", "inactive@example.com"}
    response_text = response.text
    assert "password_hash" not in response_text
    assert "token" not in response_text.lower()
    assert "privacy_agreed_at" not in response_text


def test_admin_users_filters_q_role_active_and_deleted(client: TestClient, db: Session) -> None:
    seed_users(db)
    login(client, "admin@example.com")

    assert [item["email"] for item in client.get("/api/admin/users", params={"q": "inactive"}).json()["users"]] == ["inactive@example.com"]
    assert [item["email"] for item in client.get("/api/admin/users", params={"role": "ADMIN"}).json()["users"]] == ["admin@example.com"]
    inactive = client.get("/api/admin/users", params={"active": "false"}).json()
    assert [item["email"] for item in inactive["users"]] == ["inactive@example.com"]
    with_deleted = client.get("/api/admin/users", params={"active": "false", "include_deleted": "true"}).json()
    assert {item["email"] for item in with_deleted["users"]} == {"inactive@example.com", "deleted@example.com"}


def seed_community_posts(db: Session) -> None:
    now = datetime.now(tz=UTC)
    add_user(db, user_id=1, email="admin@example.com", nickname="관리자", role="ADMIN", created_at=now)
    add_user(db, user_id=2, email="writer@example.com", nickname="작성자", created_at=now)
    db.add_all([
        CommunityPost(id=1, user_id=2, category="FIELD_STORY", title="공을 봤어요", content="공 목격", place_name="서울역", is_notice=False, created_at=now, updated_at=now),
        CommunityPost(id=2, user_id=2, category="QUESTION", title="도움 요청", content="가방 찾기", place_name="잠실", is_notice=False, created_at=now - timedelta(days=1), updated_at=now - timedelta(days=1)),
        CommunityPost(id=3, user_id=1, category="OPINION", title="공지입니다", content="운영 공지", place_name=None, is_notice=True, created_at=now - timedelta(days=2), updated_at=now - timedelta(days=2)),
        CommunityPost(id=4, user_id=2, category="EXPERIENCE", title="삭제 글", content="hidden", place_name="부산", is_notice=False, created_at=now - timedelta(days=8), updated_at=now - timedelta(days=8), deleted_at=now),
    ])
    db.flush()
    db.add_all([
        CommunityComment(id=1, post_id=1, user_id=2, content="댓글", created_at=now, updated_at=now),
        CommunityComment(id=2, post_id=1, user_id=2, content="삭제 댓글", created_at=now, updated_at=now, deleted_at=now),
        CommunityComment(id=3, post_id=2, user_id=2, content="댓글", created_at=now, updated_at=now),
    ])
    db.commit()


def test_admin_community_posts_returns_safe_summary_and_filters(client: TestClient, db: Session) -> None:
    seed_community_posts(db)
    assert client.get("/api/admin/community-posts").status_code == 401
    login(client, "writer@example.com")
    assert client.get("/api/admin/community-posts").status_code == 403
    client.post("/api/auth/logout")
    login(client, "admin@example.com")

    response = client.get("/api/admin/community-posts")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["total"] == 4
    assert body["summary"]["visible"] == 3
    assert body["summary"]["deleted"] == 1
    assert body["summary"]["notices"] == 1
    assert body["summary"]["comments"] == 2
    assert body["total"] == 3
    assert [item["id"] for item in body["posts"]] == [1, 2, 3]
    assert body["posts"][0]["comment_count"] == 1
    response_text = response.text
    assert "writer@example.com" not in response_text
    assert "password_hash" not in response_text
    assert "token" not in response_text.lower()

    assert [item["id"] for item in client.get("/api/admin/community-posts", params={"q": "서울"}).json()["posts"]] == [1]
    assert [item["id"] for item in client.get("/api/admin/community-posts", params={"category": "QUESTION"}).json()["posts"]] == [2]
    assert [item["id"] for item in client.get("/api/admin/community-posts", params={"notice": "true"}).json()["posts"]] == [3]
    assert [item["id"] for item in client.get("/api/admin/community-posts", params={"include_deleted": "true", "q": "삭제"}).json()["posts"]] == [4]
