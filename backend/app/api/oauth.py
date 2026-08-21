from __future__ import annotations

from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.auth import set_login_cookie
from app.core.config import get_settings
from app.db.session import get_db
from app.schemas.auth import OAuthCompleteRequest, UserResponse
from app.services.oauth.providers import OAuthProviderError, get_oauth_provider
from app.services.oauth.service import (
    PENDING_TTL_SECONDS,
    STATE_TTL_SECONDS,
    complete_social_registration,
    create_oauth_start,
    process_oauth_identity,
    verify_oauth_state,
)

router = APIRouter(prefix="/api/auth/oauth", tags=["auth"])
STATE_COOKIE_NAME = "flowlink_oauth_state"
PENDING_COOKIE_NAME = "flowlink_oauth_pending"


def _provider_name(value: str) -> str:
    provider = value.upper()
    if provider not in {"GOOGLE", "KAKAO", "NAVER"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OAuth provider not found")
    return provider


def _set_private_cookie(response: Response, *, key: str, value: str, max_age: int) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age,
        httponly=True,
        secure=get_settings().auth_cookie_secure,
        samesite="lax",
        path="/api/auth/oauth",
    )


def _delete_private_cookie(response: Response, key: str) -> None:
    response.delete_cookie(
        key=key,
        httponly=True,
        secure=get_settings().auth_cookie_secure,
        samesite="lax",
        path="/api/auth/oauth",
    )


def _error_redirect(
    provider: str,
    error: str,
    *,
    provider_step: str | None = None,
    provider_detail: str | None = None,
) -> RedirectResponse:
    safe_error = error if error in {"denied", "state", "provider", "email", "conflict", "account"} else "provider"
    params = {"oauth_error": provider.lower(), "reason": safe_error}
    safe_provider_steps = {"token", "response", "id_token", "verification", "nonce", "issuer", "profile", "email"}
    if safe_error == "provider" and provider_step in safe_provider_steps:
        params["provider_step"] = provider_step
    safe_provider_details = {"audience", "signature", "expired", "clock", "invalid"}
    if provider_step == "verification" and provider_detail in safe_provider_details:
        params["provider_detail"] = provider_detail
    url = f"{get_settings().FRONTEND_URL.rstrip('/')}/login?" + urlencode(params)
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND)


@router.get("/{provider}/start", summary="Start OAuth login")
def oauth_start(provider: str) -> RedirectResponse:
    provider_name = _provider_name(provider)
    oauth_provider = get_oauth_provider(provider_name)
    if not oauth_provider.configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OAuth provider not configured")
    start = create_oauth_start(provider_name)
    response = RedirectResponse(
        oauth_provider.authorization_url(
            state=start.state,
            nonce=start.nonce,
            code_challenge=start.code_challenge,
        ),
        status_code=status.HTTP_302_FOUND,
    )
    _set_private_cookie(response, key=STATE_COOKIE_NAME, value=start.cookie_token, max_age=STATE_TTL_SECONDS)
    return response


@router.get("/{provider}/callback", summary="Complete OAuth provider callback")
def oauth_callback(
    provider: str,
    db: Annotated[Session, Depends(get_db)],
    code: Annotated[str | None, Query()] = None,
    state_value: Annotated[str | None, Query(alias="state")] = None,
    provider_error: Annotated[str | None, Query(alias="error")] = None,
    state_cookie: Annotated[str | None, Cookie(alias=STATE_COOKIE_NAME)] = None,
) -> RedirectResponse:
    provider_name = _provider_name(provider)
    if provider_error or not code:
        response = _error_redirect(provider_name, "denied")
        _delete_private_cookie(response, STATE_COOKIE_NAME)
        return response
    try:
        state_payload = verify_oauth_state(state_cookie, state_value, provider_name)
        oauth_provider = get_oauth_provider(provider_name)
        if not oauth_provider.configured:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OAuth provider not configured")
        identity = oauth_provider.fetch_identity(
            code=code,
            state=state_value or "",
            nonce=str(state_payload["nonce"]),
            code_verifier=state_payload.get("code_verifier"),
        )
        result = process_oauth_identity(db, identity)
    except HTTPException as exc:
        reason = "state" if exc.status_code in {400, 401} else "conflict" if exc.status_code == 409 else "account"
        response = _error_redirect(provider_name, reason)
    except OAuthProviderError as exc:
        error_message = str(exc)
        provider_step = {
            "Provider token exchange failed": "token",
            "Invalid provider token response": "response",
            "Provider profile request failed": "profile",
            "Invalid provider profile response": "profile",
            "Google ID token is missing": "id_token",
            "Google nonce verification failed": "nonce",
            "Google issuer verification failed": "issuer",
            "Google subject is missing": "profile",
            "A verified Google email is required": "email",
        }.get(error_message, "verification" if error_message.startswith("Google ID token verification failed:") else "response")
        provider_detail = error_message.partition(":")[2] if provider_step == "verification" else None
        response = _error_redirect(
            provider_name,
            "provider",
            provider_step=provider_step,
            provider_detail=provider_detail,
        )
    else:
        if result.login is not None:
            response = RedirectResponse(get_settings().FRONTEND_URL.rstrip("/") + "/", status_code=302)
            set_login_cookie(response, result.login.access_token, result.login.expires_in)
        else:
            response = RedirectResponse(
                f"{get_settings().FRONTEND_URL.rstrip('/')}/register?social={provider_name.lower()}",
                status_code=302,
            )
            assert result.pending_token is not None
            _set_private_cookie(
                response,
                key=PENDING_COOKIE_NAME,
                value=result.pending_token,
                max_age=PENDING_TTL_SECONDS,
            )
    _delete_private_cookie(response, STATE_COOKIE_NAME)
    return response


@router.post("/complete", response_model=UserResponse, status_code=201, summary="Complete social registration")
def oauth_complete(
    request: OAuthCompleteRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    pending_cookie: Annotated[str | None, Cookie(alias=PENDING_COOKIE_NAME)] = None,
) -> UserResponse:
    result = complete_social_registration(db, pending_cookie, request)
    set_login_cookie(response, result.access_token, result.expires_in)
    _delete_private_cookie(response, PENDING_COOKIE_NAME)
    return result.user
