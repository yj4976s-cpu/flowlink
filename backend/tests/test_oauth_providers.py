from __future__ import annotations

import pytest

from app.core.config import Settings
from app.services.oauth.providers import (
    GoogleOAuthProvider,
    KakaoOAuthProvider,
    NaverOAuthProvider,
    OAuthProviderError,
)


def oauth_settings() -> Settings:
    return Settings(
        GOOGLE_CLIENT_ID="google-client",
        GOOGLE_CLIENT_SECRET="google-secret",
        KAKAO_REST_API_KEY="kakao-client",
        KAKAO_CLIENT_SECRET="kakao-secret",
        NAVER_CLIENT_ID="naver-client",
        NAVER_CLIENT_SECRET="naver-secret",
        OAUTH_BACKEND_BASE_URL="https://api.flowlink.example",
    )


def test_google_fetch_identity_verifies_claims_and_pkce(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = GoogleOAuthProvider(oauth_settings())
    captured: dict = {}

    def fake_post(_url: str, **kwargs):
        captured.update(kwargs["data"])
        return {"id_token": "signed-id-token", "access_token": "discarded"}

    monkeypatch.setattr(provider, "_post_token", fake_post)
    monkeypatch.setattr(
        "app.services.oauth.providers.google_id_token.verify_oauth2_token",
        lambda token, request, audience: {
            "iss": "https://accounts.google.com",
            "aud": audience,
            "exp": 9999999999,
            "nonce": "expected-nonce",
            "sub": "google-user-id",
            "email": "Google@Example.com",
            "email_verified": True,
        },
    )

    identity = provider.fetch_identity(
        code="code", state="state", nonce="expected-nonce", code_verifier="verifier"
    )

    assert identity.provider_user_id == "google-user-id"
    assert identity.email == "Google@Example.com"
    assert captured["code_verifier"] == "verifier"


def test_google_rejects_invalid_id_token(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = GoogleOAuthProvider(oauth_settings())
    monkeypatch.setattr(provider, "_post_token", lambda *_args, **_kwargs: {"id_token": "bad"})

    def reject_token(*_args, **_kwargs):
        raise ValueError("invalid audience")

    monkeypatch.setattr(
        "app.services.oauth.providers.google_id_token.verify_oauth2_token", reject_token
    )

    with pytest.raises(OAuthProviderError, match="verification failed"):
        provider.fetch_identity(code="code", state="state", nonce="nonce", code_verifier="verifier")


def test_google_rejects_nonce_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = GoogleOAuthProvider(oauth_settings())
    monkeypatch.setattr(provider, "_post_token", lambda *_args, **_kwargs: {"id_token": "token"})
    monkeypatch.setattr(
        "app.services.oauth.providers.google_id_token.verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "accounts.google.com",
            "nonce": "different",
            "sub": "google-id",
            "email": "user@example.com",
            "email_verified": True,
        },
    )

    with pytest.raises(OAuthProviderError, match="nonce"):
        provider.fetch_identity(code="code", state="state", nonce="nonce", code_verifier="verifier")


def test_google_rejects_unverified_email(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = GoogleOAuthProvider(oauth_settings())
    monkeypatch.setattr(provider, "_post_token", lambda *_args, **_kwargs: {"id_token": "token"})
    monkeypatch.setattr(
        "app.services.oauth.providers.google_id_token.verify_oauth2_token",
        lambda *_args, **_kwargs: {
            "iss": "accounts.google.com",
            "nonce": "nonce",
            "sub": "google-id",
            "email": "user@example.com",
            "email_verified": False,
        },
    )

    with pytest.raises(OAuthProviderError, match="verified Google email"):
        provider.fetch_identity(code="code", state="state", nonce="nonce", code_verifier="verifier")


def test_kakao_uses_stable_user_id_and_verified_email(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = KakaoOAuthProvider(oauth_settings())
    monkeypatch.setattr(provider, "_post_token", lambda *_args, **_kwargs: {"access_token": "token"})
    monkeypatch.setattr(
        provider,
        "_get_json",
        lambda *_args, **_kwargs: {
            "id": 12345,
            "kakao_account": {
                "email": "kakao@example.com",
                "is_email_valid": True,
                "is_email_verified": True,
            },
            "properties": {"nickname": "Kakao user"},
        },
    )

    identity = provider.fetch_identity(code="code", state="state", nonce="nonce", code_verifier=None)

    assert identity.provider_user_id == "12345"
    assert identity.email == "kakao@example.com"


def test_kakao_discards_unverified_email(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = KakaoOAuthProvider(oauth_settings())
    monkeypatch.setattr(provider, "_post_token", lambda *_args, **_kwargs: {"access_token": "token"})
    monkeypatch.setattr(
        provider,
        "_get_json",
        lambda *_args, **_kwargs: {
            "id": 12345,
            "kakao_account": {"email": "kakao@example.com", "is_email_verified": False},
        },
    )

    identity = provider.fetch_identity(code="code", state="state", nonce="nonce", code_verifier=None)

    assert identity.email is None


def test_naver_validates_response_envelope_and_uses_profile_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = NaverOAuthProvider(oauth_settings())
    token_request: dict = {}

    def fake_token(_url: str, **kwargs):
        token_request.update(kwargs["data"])
        return {"access_token": "token"}

    monkeypatch.setattr(provider, "_post_token", fake_token)
    monkeypatch.setattr(
        provider,
        "_get_json",
        lambda *_args, **_kwargs: {
            "resultcode": "00",
            "response": {"id": "naver-id", "email": "naver@example.com", "nickname": "Naver"},
        },
    )

    identity = provider.fetch_identity(code="code", state="csrf-state", nonce="nonce", code_verifier=None)

    assert identity.provider_user_id == "naver-id"
    assert token_request["state"] == "csrf-state"


def test_naver_rejects_invalid_profile_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = NaverOAuthProvider(oauth_settings())
    monkeypatch.setattr(provider, "_post_token", lambda *_args, **_kwargs: {"access_token": "token"})
    monkeypatch.setattr(
        provider,
        "_get_json",
        lambda *_args, **_kwargs: {"resultcode": "99", "message": "failed"},
    )

    with pytest.raises(OAuthProviderError, match="profile"):
        provider.fetch_identity(code="code", state="state", nonce="nonce", code_verifier=None)
