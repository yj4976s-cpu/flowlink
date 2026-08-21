from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import User, UserSocialAccount
from app.services.oauth.providers import OAuthIdentity


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


def test_social_only_user_password_login_returns_401(client: TestClient, db: Session) -> None:
    user = seed_user(db, email="social-only@example.com")
    user.password_hash = None
    db.commit()

    response = login(client, email="social-only@example.com", password="password123")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


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


def test_social_only_user_password_change_returns_domain_error(client: TestClient, db: Session) -> None:
    settings = get_settings()
    user = seed_user(db, email="social-only@example.com")
    user.password_hash = None
    db.commit()
    token, _ = create_access_token(user.id, user.role)
    client.cookies.set(settings.AUTH_COOKIE_NAME, token)

    response = client.patch(
        "/api/auth/me/password",
        json={"current_password": "not-configured", "new_password": "TestPass1"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Password is not set for this account"


def test_user_can_link_each_supported_social_provider(db: Session) -> None:
    user = seed_user(db)
    now = utc_now()
    accounts = [
        UserSocialAccount(
            id=index,
            user_id=user.id,
            provider=provider,
            provider_user_id=f"{provider.lower()}-123",
            provider_email=f"{provider.lower()}@example.com",
            created_at=now,
            updated_at=now,
        )
        for index, provider in enumerate(("GOOGLE", "NAVER", "KAKAO"), start=1)
    ]
    db.add_all(accounts)
    db.commit()

    db.refresh(user)
    assert {account.provider for account in user.social_accounts} == {"GOOGLE", "NAVER", "KAKAO"}


def test_social_provider_identity_cannot_link_to_multiple_users(db: Session) -> None:
    first = seed_user(db, user_id=1, email="first@example.com")
    second = seed_user(db, user_id=2, email="second@example.com")
    now = utc_now()
    db.add(UserSocialAccount(
        id=1,
        user_id=first.id,
        provider="GOOGLE",
        provider_user_id="google-duplicate",
        created_at=now,
        updated_at=now,
    ))
    db.commit()
    db.add(UserSocialAccount(
        id=2,
        user_id=second.id,
        provider="GOOGLE",
        provider_user_id="google-duplicate",
        created_at=now,
        updated_at=now,
    ))

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_user_cannot_link_same_provider_twice(db: Session) -> None:
    user = seed_user(db)
    now = utc_now()
    db.add(UserSocialAccount(
        id=1,
        user_id=user.id,
        provider="NAVER",
        provider_user_id="naver-first",
        created_at=now,
        updated_at=now,
    ))
    db.commit()
    db.add(UserSocialAccount(
        id=2,
        user_id=user.id,
        provider="NAVER",
        provider_user_id="naver-second",
        created_at=now,
        updated_at=now,
    ))

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_social_account_rejects_unsupported_provider(db: Session) -> None:
    user = seed_user(db)
    now = utc_now()
    db.add(UserSocialAccount(
        id=1,
        user_id=user.id,
        provider="GITHUB",
        provider_user_id="github-123",
        created_at=now,
        updated_at=now,
    ))

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


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


class FakeOAuthProvider:
    configured = True

    def __init__(self, identity: OAuthIdentity) -> None:
        self.identity = identity

    def authorization_url(self, *, state: str, nonce: str, code_challenge: str | None) -> str:
        return f"https://provider.example/authorize?state={state}"

    def fetch_identity(
        self, *, code: str, state: str, nonce: str, code_verifier: str | None
    ) -> OAuthIdentity:
        assert code == "valid-code"
        return self.identity


def configure_fake_oauth(monkeypatch: pytest.MonkeyPatch, identity: OAuthIdentity) -> None:
    monkeypatch.setattr(
        "app.api.oauth.get_oauth_provider",
        lambda _provider: FakeOAuthProvider(identity),
    )


def begin_oauth(client: TestClient, provider: str = "google") -> str:
    response = client.get(f"/api/auth/oauth/{provider}/start", follow_redirects=False)
    assert response.status_code == 302
    assert "flowlink_oauth_state" in response.headers["set-cookie"]
    return response.headers["location"].split("state=", 1)[1]


def test_google_oauth_start_redirect_and_state_cookie(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_fake_oauth(monkeypatch, OAuthIdentity("GOOGLE", "g-1", "new@example.com", "new"))

    state_value = begin_oauth(client)

    assert state_value


def test_oauth_start_returns_503_when_provider_is_not_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = FakeOAuthProvider(OAuthIdentity("GOOGLE", "g-1", "new@example.com", "new"))
    provider.configured = False
    monkeypatch.setattr("app.api.oauth.get_oauth_provider", lambda _provider: provider)

    response = client.get("/api/auth/oauth/google/start")

    assert response.status_code == 503


def test_oauth_callback_rejects_state_mismatch(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_fake_oauth(monkeypatch, OAuthIdentity("GOOGLE", "g-1", "new@example.com", "new"))
    begin_oauth(client)

    response = client.get(
        "/api/auth/oauth/google/callback?code=valid-code&state=wrong",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert "oauth_error=google" in response.headers["location"]
    assert "reason=state" in response.headers["location"]
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_returning_social_user_receives_existing_login_cookie(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = seed_user(db)
    now = utc_now()
    db.add(UserSocialAccount(
        user_id=user.id,
        provider="GOOGLE",
        provider_user_id="g-returning",
        provider_email="old@example.com",
        created_at=now,
        updated_at=now,
    ))
    db.commit()
    configure_fake_oauth(
        monkeypatch,
        OAuthIdentity("GOOGLE", "g-returning", "updated@example.com", "user"),
    )
    state_value = begin_oauth(client)

    response = client.get(
        f"/api/auth/oauth/google/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert get_settings().AUTH_COOKIE_NAME in response.headers["set-cookie"]
    assert db.get(User, user.id).last_login_at is not None


@pytest.mark.parametrize("active,deleted", [(False, False), (False, True)])
def test_disabled_social_user_is_not_logged_in(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    active: bool,
    deleted: bool,
) -> None:
    user = seed_user(db, active=active, deleted=deleted)
    now = utc_now()
    db.add(UserSocialAccount(
        user_id=user.id,
        provider="NAVER",
        provider_user_id="n-disabled",
        created_at=now,
        updated_at=now,
    ))
    db.commit()
    configure_fake_oauth(monkeypatch, OAuthIdentity("NAVER", "n-disabled", "user@example.com", "user"))
    state_value = begin_oauth(client, "naver")

    response = client.get(
        f"/api/auth/oauth/naver/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )

    assert "oauth_error=naver" in response.headers["location"]
    assert get_settings().AUTH_COOKIE_NAME not in response.headers.get("set-cookie", "")


def test_new_social_user_gets_pending_cookie_without_user_creation(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_fake_oauth(monkeypatch, OAuthIdentity("KAKAO", "k-new", "new@example.com", "new-user"))
    state_value = begin_oauth(client, "kakao")

    response = client.get(
        f"/api/auth/oauth/kakao/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"].endswith("/register?social=kakao")
    assert "flowlink_oauth_pending" in response.headers["set-cookie"]
    assert db.query(User).count() == 0


def test_social_callback_does_not_auto_link_existing_email(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed_user(db, email="same@example.com")
    configure_fake_oauth(monkeypatch, OAuthIdentity("GOOGLE", "g-new", "same@example.com", "same"))
    state_value = begin_oauth(client)

    response = client.get(
        f"/api/auth/oauth/google/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )

    assert "reason=conflict" in response.headers["location"]
    assert db.query(UserSocialAccount).count() == 0


def test_social_callback_links_verified_provider_email_to_active_user(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = seed_user(db, email="same@example.com")
    configure_fake_oauth(
        monkeypatch,
        OAuthIdentity("KAKAO", "k-verified", "same@example.com", "same", email_verified=True),
    )
    state_value = begin_oauth(client, "kakao")

    response = client.get(
        f"/api/auth/oauth/kakao/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == get_settings().FRONTEND_URL.rstrip("/") + "/"
    assert get_settings().AUTH_COOKIE_NAME in response.headers["set-cookie"]
    account = db.query(UserSocialAccount).one()
    assert account.user_id == user.id
    assert account.provider == "KAKAO"
    assert account.provider_user_id == "k-verified"


def test_social_callback_rejects_new_provider_user_without_email(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_fake_oauth(monkeypatch, OAuthIdentity("KAKAO", "k-no-email", None, "kakao"))
    state_value = begin_oauth(client, "kakao")

    response = client.get(
        f"/api/auth/oauth/kakao/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )

    assert "oauth_error=kakao" in response.headers["location"]
    assert db.query(User).count() == 0


def test_complete_social_registration_creates_both_rows_and_login_cookie(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure_fake_oauth(monkeypatch, OAuthIdentity("NAVER", "n-new", "naver@example.com", "naver"))
    state_value = begin_oauth(client, "naver")
    client.get(
        f"/api/auth/oauth/naver/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )

    response = client.post(
        "/api/auth/oauth/complete",
        json={"nickname": "naver-user", "terms_agreed": True, "privacy_agreed": True},
    )

    assert response.status_code == 201
    user = db.query(User).one()
    social = db.query(UserSocialAccount).one()
    assert user.password_hash is None
    assert social.user_id == user.id
    assert social.provider == "NAVER"
    assert get_settings().AUTH_COOKIE_NAME in response.headers["set-cookie"]
    assert "flowlink_oauth_pending=" in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_complete_social_registration_requires_pending_cookie(client: TestClient) -> None:
    response = client.post(
        "/api/auth/oauth/complete",
        json={"nickname": "new-user", "terms_agreed": True, "privacy_agreed": True},
    )

    assert response.status_code == 401


def test_complete_social_registration_rejects_tampered_pending_cookie(client: TestClient) -> None:
    client.cookies.set("flowlink_oauth_pending", "not-a-valid-token", path="/api/auth/oauth")

    response = client.post(
        "/api/auth/oauth/complete",
        json={"nickname": "new-user", "terms_agreed": True, "privacy_agreed": True},
    )

    assert response.status_code == 401


def test_complete_social_registration_rejects_expired_pending_cookie(client: TestClient) -> None:
    settings = get_settings()
    expired = jwt.encode(
        {
            "aud": "flowlink-oauth-pending",
            "exp": utc_now() - timedelta(seconds=1),
            "provider": "GOOGLE",
            "provider_user_id": "g-expired",
            "provider_email": "expired@example.com",
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    client.cookies.set("flowlink_oauth_pending", expired, path="/api/auth/oauth")

    response = client.post(
        "/api/auth/oauth/complete",
        json={"nickname": "new-user", "terms_agreed": True, "privacy_agreed": True},
    )

    assert response.status_code == 401


@pytest.mark.parametrize("field", ["terms_agreed", "privacy_agreed"])
def test_complete_social_registration_requires_agreements(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, field: str
) -> None:
    configure_fake_oauth(monkeypatch, OAuthIdentity("GOOGLE", "g-new", "new@example.com", "new"))
    state_value = begin_oauth(client)
    client.get(
        f"/api/auth/oauth/google/callback?code=valid-code&state={state_value}",
        follow_redirects=False,
    )
    body = {"nickname": "new-user", "terms_agreed": True, "privacy_agreed": True}
    body[field] = False

    response = client.post("/api/auth/oauth/complete", json=body)

    assert response.status_code == 400


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
