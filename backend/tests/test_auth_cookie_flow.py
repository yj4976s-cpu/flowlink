from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.security import hash_password, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import User


@compiles(BigInteger, "sqlite")
def compile_big_integer_for_sqlite(_type, _compiler, **_kwargs) -> str:
    return "INTEGER"


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


def register(
    client: TestClient,
    *,
    email: str = "new-user@example.com",
    password: str = "abcd1234",
    terms_agreed: bool = True,
    privacy_agreed: bool = True,
):
    return client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "nickname": "new-user",
            "terms_agreed": terms_agreed,
            "privacy_agreed": privacy_agreed,
        },
    )


def assert_cookie_deleted(set_cookie: str) -> None:
    settings = get_settings()
    assert f"{settings.AUTH_COOKIE_NAME}=" in set_cookie
    assert "Max-Age=0" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie


def test_register_returns_created(client: TestClient) -> None:
    response = register(client)

    assert response.status_code == 201


def test_register_ignores_client_supplied_admin_role(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "email": "role-injection@example.com",
            "password": "abcd1234",
            "nickname": "role-test",
            "terms_agreed": True,
            "privacy_agreed": True,
            "role": "ADMIN",
        },
    )

    assert response.status_code == 201
    assert response.json()["role"] == "USER"
    assert client.get("/api/auth/me").json()["role"] == "USER"


def test_register_sets_httponly_cookie(client: TestClient) -> None:
    settings = get_settings()
    response = register(client)

    set_cookie = response.headers["set-cookie"]
    assert f"{settings.AUTH_COOKIE_NAME}=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie


def test_register_cookie_authenticates_me(client: TestClient) -> None:
    assert register(client).status_code == 201

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == "new-user@example.com"


def test_duplicate_registration_does_not_set_cookie(client: TestClient) -> None:
    settings = get_settings()
    assert register(client).status_code == 201
    client.cookies.clear()

    response = register(client)

    assert response.status_code == 409
    assert settings.AUTH_COOKIE_NAME not in response.headers.get("set-cookie", "")


def test_deleted_user_can_register_again_as_a_new_account(client: TestClient, db: Session) -> None:
    old_user = seed_user(db, email="new-user@example.com")
    assert login(client, email="new-user@example.com").status_code == 200
    assert client.delete("/api/auth/me").status_code == 200

    response = register(client, email="new-user@example.com")

    assert response.status_code == 201
    assert response.json()["email"] == "new-user@example.com"
    new_user = db.query(User).filter(User.email == "new-user@example.com").one()
    db.refresh(old_user)
    assert new_user.id != old_user.id
    assert old_user.active is False and old_user.deleted_at is not None
    assert old_user.email == f"deleted-user-{old_user.id}@flowlink.invalid"
    assert client.get("/api/auth/me").json()["id"] == new_user.id


def test_legacy_deleted_user_email_is_released_during_registration(client: TestClient, db: Session) -> None:
    old_user = seed_user(db, email="new-user@example.com", active=False, deleted=True)

    response = register(client, email="new-user@example.com")

    assert response.status_code == 201
    db.refresh(old_user)
    assert old_user.email == f"deleted-user-{old_user.id}@flowlink.invalid"
    assert db.query(User).filter(User.email == "new-user@example.com", User.active.is_(True)).count() == 1


def test_registration_without_required_agreement_does_not_set_cookie(client: TestClient) -> None:
    settings = get_settings()

    response = register(client, terms_agreed=False)

    assert response.status_code == 400
    assert settings.AUTH_COOKIE_NAME not in response.headers.get("set-cookie", "")


@pytest.mark.parametrize("password", ["abcdefgh", "ABCDEFGH", "12345678", "abc1234", "Abcdefg!"])
def test_register_rejects_invalid_password_policy(client: TestClient, password: str) -> None:
    response = register(client, email=f"{password.encode().hex()}@example.com", password=password)

    assert response.status_code == 422


@pytest.mark.parametrize("length", [8, 128])
def test_register_accepts_password_length_boundaries(client: TestClient, length: int) -> None:
    response = register(
        client,
        email=f"register-boundary-{length}@example.com",
        password="a1" + "x" * (length - 2),
    )

    assert response.status_code == 201


def test_register_rejects_password_over_max_length(client: TestClient) -> None:
    response = register(
        client,
        email="register-over-limit@example.com",
        password="a1" + "x" * 127,
    )

    assert response.status_code == 422


def test_registration_rolls_back_when_token_creation_fails(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_token_creation(*_args, **_kwargs):
        raise RuntimeError("token creation failed")

    monkeypatch.setattr("app.services.auth.create_access_token", fail_token_creation)

    with pytest.raises(RuntimeError, match="token creation failed"):
        register(client)

    assert db.query(User).filter(User.email == "new-user@example.com").one_or_none() is None


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


def test_update_nickname_returns_safe_user_response(client: TestClient, db: Session) -> None:
    seed_user(db)
    assert login(client).status_code == 200

    response = client.patch("/api/auth/me", json={"nickname": "river-user"})

    assert response.status_code == 200
    assert response.json()["nickname"] == "river-user"
    assert "password" not in response.json()
    assert "password_hash" not in response.json()


def test_change_password_requires_current_password(client: TestClient, db: Session) -> None:
    seed_user(db)
    assert login(client).status_code == 200

    response = client.patch(
        "/api/auth/me/password",
        json={"current_password": "incorrect", "new_password": "TestPass1"},
    )

    assert response.status_code == 400
    client.cookies.clear()
    assert login(client, password="password123").status_code == 200


def test_change_password_replaces_password_hash(client: TestClient, db: Session) -> None:
    seed_user(db)
    assert login(client).status_code == 200

    response = client.patch(
        "/api/auth/me/password",
        json={"current_password": "password123", "new_password": "TestPass1"},
    )

    assert response.status_code == 200
    assert "password" not in response.json()
    assert "password_hash" not in response.json()
    client.cookies.clear()
    assert login(client, password="password123").status_code == 401
    assert login(client, password="TestPass1").status_code == 200


@pytest.mark.parametrize("new_password", ["abcdefgh", "12345678", "abc1234"])
def test_change_password_rejects_invalid_new_password_policy(
    client: TestClient,
    db: Session,
    new_password: str,
) -> None:
    seed_user(db, password="legacy-password123!")
    assert login(client, password="legacy-password123!").status_code == 200

    response = client.patch(
        "/api/auth/me/password",
        json={"current_password": "legacy-password123!", "new_password": new_password},
    )

    assert response.status_code == 422
    client.cookies.clear()
    assert login(client, password="legacy-password123!").status_code == 200


def test_change_password_accepts_max_length_boundary(client: TestClient, db: Session) -> None:
    seed_user(db, password="legacy-password123!")
    assert login(client, password="legacy-password123!").status_code == 200
    new_password = "a1" + "x" * 126

    response = client.patch(
        "/api/auth/me/password",
        json={"current_password": "legacy-password123!", "new_password": new_password},
    )

    assert response.status_code == 200
    client.cookies.clear()
    assert login(client, password=new_password).status_code == 200


def test_change_password_rejects_over_max_length(client: TestClient, db: Session) -> None:
    seed_user(db, password="legacy-password123!")
    assert login(client, password="legacy-password123!").status_code == 200

    response = client.patch(
        "/api/auth/me/password",
        json={"current_password": "legacy-password123!", "new_password": "a1" + "x" * 127},
    )

    assert response.status_code == 422
    client.cookies.clear()
    assert login(client, password="legacy-password123!").status_code == 200


def test_me_rejects_missing_or_tampered_cookie(client: TestClient) -> None:
    settings = get_settings()

    missing_response = client.get("/api/auth/me")
    client.cookies.set(settings.AUTH_COOKIE_NAME, "not-a-jwt")
    tampered_response = client.get("/api/auth/me")

    assert missing_response.status_code == 401
    assert tampered_response.status_code == 401


def test_logout_deletes_cookie_and_blocks_followup_me(client: TestClient, db: Session) -> None:
    seed_user(db)
    assert login(client).status_code == 200

    logout_response = client.post("/api/auth/logout")
    me_response = client.get("/api/auth/me")

    assert logout_response.status_code == 200
    assert_cookie_deleted(logout_response.headers["set-cookie"])
    assert me_response.status_code == 401


def test_logout_deletes_tampered_cookie_without_authentication(client: TestClient) -> None:
    settings = get_settings()
    client.cookies.set(settings.AUTH_COOKIE_NAME, "not-a-jwt")

    response = client.post("/api/auth/logout")

    assert response.status_code == 200
    assert_cookie_deleted(response.headers["set-cookie"])


def test_logout_without_cookie_is_successful(client: TestClient) -> None:
    response = client.post("/api/auth/logout")

    assert response.status_code == 200
    assert_cookie_deleted(response.headers["set-cookie"])


def test_delete_me_deletes_cookie_and_blocks_followup_me(client: TestClient, db: Session) -> None:
    seed_user(db)
    assert login(client).status_code == 200

    delete_response = client.delete("/api/auth/me")
    me_response = client.get("/api/auth/me")

    assert delete_response.status_code == 200
    assert_cookie_deleted(delete_response.headers["set-cookie"])
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
    assert admin_response.status_code == 200
    assert admin_response.json() == []

    client.cookies.clear()
    user_login = login(client, email="user@example.com")
    assert user_login.status_code == 200
    user_response = client.get("/api/admin/detections")
    assert user_response.status_code == 403


def test_admin_cookie_is_forbidden_from_user_personal_activity_api(client: TestClient, db: Session) -> None:
    seed_user(db, user_id=1, email="admin-personal@example.com", role="ADMIN")
    assert login(client, email="admin-personal@example.com").status_code == 200

    response = client.get("/api/matches/me")

    assert response.status_code == 403


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
