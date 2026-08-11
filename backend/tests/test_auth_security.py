from datetime import UTC, timedelta

import jwt
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.auth import ensure_active_user, ensure_admin, ensure_user
from app.core.config import Settings, get_settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    normalize_email,
    utc_now,
    verify_password,
)
from app.models import User
from app.schemas.auth import LoginRequest, PasswordChangeRequest, RegisterRequest
from app.services.auth import validate_registration_agreements


def make_user(*, role: str = "USER", active: bool = True) -> User:
    return User(
        id=1,
        email="user@example.com",
        password_hash="not-used",
        nickname="tester",
        role=role,
        active=active,
        terms_agreed_at=utc_now(),
        privacy_agreed_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
    )


def test_register_rejects_false_agreement() -> None:
    request = RegisterRequest(
        email="USER@example.com",
        password="AbcdefGh",
        nickname="tester",
        terms_agreed=False,
        privacy_agreed=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        validate_registration_agreements(request)

    assert exc_info.value.status_code == 400


def test_register_nickname_min_length_is_checked_after_strip() -> None:
    with pytest.raises(ValidationError):
        RegisterRequest(
            email="user@example.com",
            password="AbcdefGh",
            nickname=" a ",
            terms_agreed=True,
            privacy_agreed=True,
        )


@pytest.mark.parametrize("password", ["AbcdefGh", "FLOWlink", "TestPass"])
def test_register_accepts_password_policy(password: str) -> None:
    request = RegisterRequest(
        email="user@example.com",
        password=password,
        nickname="tester",
        terms_agreed=True,
        privacy_agreed=True,
    )

    assert request.password == password


@pytest.mark.parametrize(
    "password",
    ["abcdefgh", "ABCDEFGH", "Abcdefg1", "Abcdefg!", "Abcdefg", "Abcdefghi", "Abcd efG", "가AbcdefG"],
)
def test_register_rejects_password_policy(password: str) -> None:
    with pytest.raises(ValidationError):
        RegisterRequest(
            email="user@example.com",
            password=password,
            nickname="tester",
            terms_agreed=True,
            privacy_agreed=True,
        )


@pytest.mark.parametrize("new_password", ["AbcdefGh", "TestPass"])
def test_password_change_accepts_new_password_policy(new_password: str) -> None:
    request = PasswordChangeRequest(current_password="legacy-password123!", new_password=new_password)

    assert request.current_password == "legacy-password123!"
    assert request.new_password == new_password


@pytest.mark.parametrize("new_password", ["abcdefgh", "Abcdefg1"])
def test_password_change_rejects_new_password_policy(new_password: str) -> None:
    with pytest.raises(ValidationError):
        PasswordChangeRequest(current_password="legacy-password123!", new_password=new_password)


def test_login_request_allows_legacy_password_format() -> None:
    request = LoginRequest(email="user@example.com", password="legacy-password123!")

    assert request.password == "legacy-password123!"


def test_email_normalization() -> None:
    assert normalize_email("  USER@Example.COM ") == "user@example.com"


def test_password_hash_is_not_plaintext_and_verifies() -> None:
    hashed = hash_password("password123")

    assert hashed != "password123"
    assert verify_password("password123", hashed)
    assert not verify_password("wrong-password", hashed)


def test_jwt_creation_and_decode() -> None:
    token, expires_in = create_access_token(user_id=123, role="USER")
    payload = decode_access_token(token)

    assert payload["sub"] == "123"
    assert payload["role"] == "USER"
    assert expires_in == get_settings().ACCESS_TOKEN_EXPIRE_MINUTES * 60


def test_expired_token_is_rejected() -> None:
    settings = get_settings()
    expired_token = jwt.encode(
        {"sub": "123", "role": "USER", "exp": utc_now() - timedelta(minutes=1)},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

    with pytest.raises(HTTPException) as exc_info:
        decode_access_token(expired_token)

    assert exc_info.value.status_code == 401


def test_auth_cookie_secure_follows_app_env() -> None:
    assert not Settings(APP_ENV="development").auth_cookie_secure
    assert Settings(APP_ENV="production").auth_cookie_secure


def test_user_and_admin_roles_are_separated() -> None:
    with pytest.raises(HTTPException) as exc_info:
        ensure_admin(make_user(role="USER"))

    assert exc_info.value.status_code == 403
    assert ensure_admin(make_user(role="ADMIN")).role == "ADMIN"
    assert ensure_user(make_user(role="USER")).role == "USER"
    with pytest.raises(HTTPException) as user_exc_info:
        ensure_user(make_user(role="ADMIN"))
    assert user_exc_info.value.status_code == 403


def test_inactive_user_is_rejected() -> None:
    inactive_user = make_user(active=False)
    inactive_user.deleted_at = utc_now()

    with pytest.raises(HTTPException) as exc_info:
        ensure_active_user(inactive_user)

    assert exc_info.value.status_code == 401
