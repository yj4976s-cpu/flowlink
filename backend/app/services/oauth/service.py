from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import jwt
from fastapi import HTTPException, status
from jwt import ExpiredSignatureError, InvalidTokenError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, normalize_email, utc_now
from app.models import User, UserSocialAccount
from app.repositories.user_flow import get_social_account, get_user_by_email
from app.schemas.auth import OAuthCompleteRequest
from app.services.auth import LoginResult
from app.services.mappers import user_response
from app.services.oauth.providers import OAuthIdentity

STATE_AUDIENCE = "flowlink-oauth-state"
PENDING_AUDIENCE = "flowlink-oauth-pending"
STATE_TTL_SECONDS = 600
PENDING_TTL_SECONDS = 600


@dataclass(frozen=True)
class OAuthStartData:
    state: str
    nonce: str
    code_verifier: str | None
    code_challenge: str | None
    cookie_token: str


@dataclass(frozen=True)
class OAuthCallbackResult:
    login: LoginResult | None
    pending_token: str | None


def create_oauth_start(provider: str, next_path: str | None = None) -> OAuthStartData:
    state_value = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64) if provider == "GOOGLE" else None
    code_challenge = None
    if code_verifier is not None:
        digest = hashlib.sha256(code_verifier.encode()).digest()
        code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    token = _encode_purpose_token(
        {
            "provider": provider,
            "state": state_value,
            "nonce": nonce,
            "code_verifier": code_verifier,
            "next_path": next_path if next_path and next_path.startswith("/") and not next_path.startswith("//") else "/",
        },
        STATE_AUDIENCE,
        STATE_TTL_SECONDS,
    )
    return OAuthStartData(state_value, nonce, code_verifier, code_challenge, token)


def verify_oauth_state(cookie_token: str | None, request_state: str | None, provider: str) -> dict[str, Any]:
    if not cookie_token or not request_state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state")
    payload = _decode_purpose_token(cookie_token, STATE_AUDIENCE)
    if payload.get("provider") != provider or not secrets.compare_digest(
        str(payload.get("state", "")), request_state
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state")
    return payload


def process_oauth_identity(db: Session, identity: OAuthIdentity) -> OAuthCallbackResult:
    social_account = get_social_account(db, identity.provider, identity.provider_user_id)
    if social_account is not None:
        user = social_account.user
        if not user.active or user.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is unavailable")
        if identity.email and social_account.provider_email != normalize_email(identity.email):
            social_account.provider_email = normalize_email(identity.email)
            social_account.updated_at = utc_now()
        user.last_login_at = utc_now()
        db.commit()
        db.refresh(user)
        access_token, expires_in = create_access_token(user.id, user.role)
        return OAuthCallbackResult(
            LoginResult(access_token, expires_in, user_response(user)), None
        )

    if not identity.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A verified provider email is required",
        )
    email = normalize_email(identity.email)
    if get_user_by_email(db, email) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    pending_token = _encode_purpose_token(
        {
            "provider": identity.provider,
            "provider_user_id": identity.provider_user_id,
            "provider_email": email,
            "suggested_nickname": identity.suggested_nickname[:50],
            "jti": secrets.token_urlsafe(24),
        },
        PENDING_AUDIENCE,
        PENDING_TTL_SECONDS,
    )
    return OAuthCallbackResult(None, pending_token)


def complete_social_registration(
    db: Session, pending_token: str | None, request: OAuthCompleteRequest
) -> LoginResult:
    if not request.terms_agreed or not request.privacy_agreed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Terms and privacy agreements are required",
        )
    if not pending_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pending registration is required")
    payload = _decode_purpose_token(pending_token, PENDING_AUDIENCE)
    provider = payload.get("provider")
    provider_user_id = payload.get("provider_user_id")
    provider_email = payload.get("provider_email")
    if provider not in {"GOOGLE", "KAKAO", "NAVER"} or not isinstance(provider_user_id, str) or not provider_user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid pending registration")
    if not isinstance(provider_email, str) or not provider_email:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Provider email is required")
    email = normalize_email(provider_email)
    if get_social_account(db, provider, provider_user_id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Social account already registered")
    if get_user_by_email(db, email) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    now = utc_now()
    user = User(
        email=email,
        password_hash=None,
        nickname=request.nickname,
        role="USER",
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        last_login_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    try:
        db.flush()
        db.add(
            UserSocialAccount(
                user_id=user.id,
                provider=provider,
                provider_user_id=provider_user_id,
                provider_email=email,
                created_at=now,
                updated_at=now,
            )
        )
        db.flush()
        access_token, expires_in = create_access_token(user.id, user.role)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Social account or email already registered") from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return LoginResult(access_token, expires_in, user_response(user))


def _encode_purpose_token(payload: dict[str, Any], audience: str, ttl_seconds: int) -> str:
    settings = get_settings()
    now = utc_now()
    claims = {
        **payload,
        "aud": audience,
        "iat": now,
        "exp": now + timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(claims, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _decode_purpose_token(token: str, audience: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            audience=audience,
        )
    except (ExpiredSignatureError, InvalidTokenError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OAuth state") from exc
