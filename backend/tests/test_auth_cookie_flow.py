from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.security import hash_password, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import User


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, class_=Session, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def seed_user(
    db: Session,
    *,
    user_id: int = 1,
    email: str = "user@example.com",
    password: str = "password123",
    role: str = "USER",
    active: bool = True,
    deleted: bool = False,
) -> User:
    now = utc_now()
    user = User(
        id=user_id,
        email=email,
        password_hash=hash_password(password),
        nickname=f"user{user_id}",
        role=role,
        active=active,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        deleted_at=now if deleted else None,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def login(client: TestClient, email: str = "user@example.com", password: str = "password123"):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_login_sets_httponly_cookie_without_exposing_access_token(client: TestClient, db: Session) -> None:
    settings = get_settings()
    seed_user(db)

    response = login(client)

    assert response.status_code == 200
    body = response.json()
    assert "access_token" not in body
    assert "token_type" not in body
    assert body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert body["user"]["email"] == "user@example.com"

    set_cookie = response.headers["set-cookie"]
    assert f"{settings.AUTH_COOKIE_NAME}=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert f"Max-Age={settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60}" in set_cookie


def test_login_failure_does_not_set_cookie(client: TestClient, db: Session) -> None:
    settings = get_settings()
    seed_user(db)

    response = login(client, password="wrong-password")

    assert response.status_code == 401
    assert settings.AUTH_COOKIE_NAME not in response.headers.get("set-cookie", "")


def test_me_uses_login_cookie(client: TestClient, db: Session) -> None:
    seed_user(db)

    login_response = login(client)
    assert login_response.status_code == 200

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == "user@example.com"


def test_me_rejects_missing_or_tampered_cookie(client: TestClient) -> None:
    settings = get_settings()

    missing_response = client.get("/api/auth/me")
    client.cookies.set(settings.AUTH_COOKIE_NAME, "not-a-jwt")
    tampered_response = client.get("/api/auth/me")

    assert missing_response.status_code == 401
    assert tampered_response.status_code == 401


def test_logout_deletes_cookie_and_blocks_followup_me(client: TestClient, db: Session) -> None:
    settings = get_settings()
    seed_user(db)
    assert login(client).status_code == 200

    logout_response = client.post("/api/auth/logout")
    me_response = client.get("/api/auth/me")

    assert logout_response.status_code == 200
    set_cookie = logout_response.headers["set-cookie"]
    assert f"{settings.AUTH_COOKIE_NAME}=" in set_cookie
    assert "Max-Age=0" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert me_response.status_code == 401


@pytest.mark.parametrize(
    ("active", "deleted"),
    [
        (False, False),
        (True, True),
    ],
)
def test_inactive_or_deleted_user_cookie_is_rejected(
    client: TestClient,
    db: Session,
    active: bool,
    deleted: bool,
) -> None:
    settings = get_settings()
    seed_user(db, active=active, deleted=deleted)
    token = jwt.encode(
        {"sub": "1", "role": "USER", "exp": utc_now() + timedelta(minutes=5)},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

    client.cookies.set(settings.AUTH_COOKIE_NAME, token)
    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_admin_cookie_allows_admin_dependency_and_user_cookie_is_forbidden(client: TestClient, db: Session) -> None:
    seed_user(db, user_id=1, email="admin@example.com", role="ADMIN")
    seed_user(db, user_id=2, email="user@example.com", role="USER")

    admin_login = login(client, email="admin@example.com")
    assert admin_login.status_code == 200
    admin_response = client.get("/api/admin/detections")
    assert admin_response.status_code == 501

    client.cookies.clear()
    user_login = login(client, email="user@example.com")
    assert user_login.status_code == 200
    user_response = client.get("/api/admin/detections")
    assert user_response.status_code == 403


def test_expired_cookie_token_is_rejected(client: TestClient, db: Session) -> None:
    settings = get_settings()
    seed_user(db)
    expired_token = jwt.encode(
        {"sub": "1", "role": "USER", "exp": utc_now() - timedelta(minutes=1)},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

    client.cookies.set(settings.AUTH_COOKIE_NAME, expired_token)
    response = client.get("/api/auth/me")

    assert response.status_code == 401
