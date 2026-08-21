from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.core.config import Settings, get_settings

HTTP_TIMEOUT_SECONDS = 10.0
GOOGLE_CLOCK_SKEW_SECONDS = 30


class OAuthProviderError(Exception):
    pass


@dataclass(frozen=True)
class OAuthIdentity:
    provider: str
    provider_user_id: str
    email: str | None
    suggested_nickname: str
    email_verified: bool = False


class OAuthProvider(ABC):
    name: str

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    @abstractmethod
    def configured(self) -> bool: ...

    @property
    def callback_url(self) -> str:
        base = self.settings.OAUTH_BACKEND_BASE_URL.rstrip("/")
        return f"{base}/api/auth/oauth/{self.name.lower()}/callback"

    @abstractmethod
    def authorization_url(
        self, *, state: str, nonce: str, code_challenge: str | None
    ) -> str: ...

    @abstractmethod
    def fetch_identity(
        self, *, code: str, state: str, nonce: str, code_verifier: str | None
    ) -> OAuthIdentity: ...

    def _post_token(self, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = httpx.post(url, timeout=HTTP_TIMEOUT_SECONDS, **kwargs)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OAuthProviderError("Provider token exchange failed") from exc
        if not isinstance(payload, dict):
            raise OAuthProviderError("Invalid provider token response")
        return payload

    def _get_json(self, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = httpx.get(url, timeout=HTTP_TIMEOUT_SECONDS, **kwargs)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OAuthProviderError("Provider profile request failed") from exc
        if not isinstance(payload, dict):
            raise OAuthProviderError("Invalid provider profile response")
        return payload


class GoogleOAuthProvider(OAuthProvider):
    name = "GOOGLE"

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.GOOGLE_CLIENT_ID.strip()
            and self.settings.GOOGLE_CLIENT_SECRET.strip()
        )

    def authorization_url(
        self, *, state: str, nonce: str, code_challenge: str | None
    ) -> str:
        params = {
            "client_id": self.settings.GOOGLE_CLIENT_ID,
            "redirect_uri": self.callback_url,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge or "",
            "code_challenge_method": "S256",
        }
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)

    def fetch_identity(
        self, *, code: str, state: str, nonce: str, code_verifier: str | None
    ) -> OAuthIdentity:
        payload = self._post_token(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": self.settings.GOOGLE_CLIENT_ID,
                "client_secret": self.settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": self.callback_url,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
        )
        raw_id_token = payload.get("id_token")
        if not isinstance(raw_id_token, str):
            raise OAuthProviderError("Google ID token is missing")
        try:
            claims = google_id_token.verify_oauth2_token(
                raw_id_token,
                google_requests.Request(),
                self.settings.GOOGLE_CLIENT_ID,
                clock_skew_in_seconds=GOOGLE_CLOCK_SKEW_SECONDS,
            )
        except (ValueError, TypeError) as exc:
            message = str(exc).lower()
            if "audience" in message:
                reason = "audience"
            elif "signature" in message or "certificate" in message:
                reason = "signature"
            elif "expired" in message:
                reason = "expired"
            elif "too early" in message or "issued at" in message or "iat" in message:
                reason = "clock"
            else:
                reason = "invalid"
            raise OAuthProviderError(f"Google ID token verification failed:{reason}") from exc
        if claims.get("nonce") != nonce:
            raise OAuthProviderError("Google nonce verification failed")
        if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
            raise OAuthProviderError("Google issuer verification failed")
        provider_user_id = claims.get("sub")
        email = claims.get("email")
        if not isinstance(provider_user_id, str) or not provider_user_id:
            raise OAuthProviderError("Google subject is missing")
        if not isinstance(email, str) or not email or claims.get("email_verified") is not True:
            raise OAuthProviderError("A verified Google email is required")
        return OAuthIdentity("GOOGLE", provider_user_id, email, _nickname(email, "Google user"), True)


class KakaoOAuthProvider(OAuthProvider):
    name = "KAKAO"

    @property
    def configured(self) -> bool:
        return bool(self.settings.KAKAO_REST_API_KEY.strip())

    def authorization_url(
        self, *, state: str, nonce: str, code_challenge: str | None
    ) -> str:
        return "https://kauth.kakao.com/oauth/authorize?" + urlencode(
            {
                "client_id": self.settings.KAKAO_REST_API_KEY,
                "redirect_uri": self.callback_url,
                "response_type": "code",
                "state": state,
                "scope": "account_email,profile_nickname",
            }
        )

    def fetch_identity(
        self, *, code: str, state: str, nonce: str, code_verifier: str | None
    ) -> OAuthIdentity:
        data = {
            "grant_type": "authorization_code",
            "client_id": self.settings.KAKAO_REST_API_KEY,
            "redirect_uri": self.callback_url,
            "code": code,
        }
        if self.settings.KAKAO_CLIENT_SECRET.strip():
            data["client_secret"] = self.settings.KAKAO_CLIENT_SECRET
        token = self._post_token("https://kauth.kakao.com/oauth/token", data=data)
        access_token = token.get("access_token")
        if not isinstance(access_token, str):
            raise OAuthProviderError("Kakao access token is missing")
        profile = self._get_json(
            "https://kapi.kakao.com/v2/user/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        provider_user_id = profile.get("id")
        account = profile.get("kakao_account")
        if not isinstance(account, dict):
            account = {}
        email = account.get("email")
        email_verified = (
            isinstance(email, str)
            and account.get("is_email_valid") is True
            and account.get("is_email_verified") is True
        )
        if not email_verified:
            email = None
        properties = profile.get("properties")
        nickname = properties.get("nickname") if isinstance(properties, dict) else None
        if provider_user_id is None:
            raise OAuthProviderError("Kakao user id is missing")
        return OAuthIdentity(
            "KAKAO", str(provider_user_id), email if isinstance(email, str) else None,
            nickname if isinstance(nickname, str) and nickname.strip() else _nickname(email, "Kakao user"),
            email_verified,
        )


class NaverOAuthProvider(OAuthProvider):
    name = "NAVER"

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.NAVER_CLIENT_ID.strip()
            and self.settings.NAVER_CLIENT_SECRET.strip()
        )

    def authorization_url(
        self, *, state: str, nonce: str, code_challenge: str | None
    ) -> str:
        return "https://nid.naver.com/oauth2.0/authorize?" + urlencode(
            {
                "response_type": "code",
                "client_id": self.settings.NAVER_CLIENT_ID,
                "redirect_uri": self.callback_url,
                "state": state,
            }
        )

    def fetch_identity(
        self, *, code: str, state: str, nonce: str, code_verifier: str | None
    ) -> OAuthIdentity:
        token = self._post_token(
            "https://nid.naver.com/oauth2.0/token",
            data={
                "grant_type": "authorization_code",
                "client_id": self.settings.NAVER_CLIENT_ID,
                "client_secret": self.settings.NAVER_CLIENT_SECRET,
                "code": code,
                "state": state,
            },
        )
        access_token = token.get("access_token")
        if not isinstance(access_token, str):
            raise OAuthProviderError("Naver access token is missing")
        payload = self._get_json(
            "https://openapi.naver.com/v1/nid/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        profile = payload.get("response")
        if payload.get("resultcode") != "00" or not isinstance(profile, dict):
            raise OAuthProviderError("Invalid Naver profile response")
        provider_user_id = profile.get("id")
        email = profile.get("email")
        nickname = profile.get("nickname") or profile.get("name")
        if not isinstance(provider_user_id, str) or not provider_user_id:
            raise OAuthProviderError("Naver user id is missing")
        return OAuthIdentity(
            "NAVER", provider_user_id, email if isinstance(email, str) else None,
            nickname if isinstance(nickname, str) and nickname.strip() else _nickname(email, "Naver user"),
        )


def _nickname(email: object, fallback: str) -> str:
    if isinstance(email, str) and "@" in email:
        return email.split("@", 1)[0][:50]
    return fallback


def get_oauth_provider(provider: str, settings: Settings | None = None) -> OAuthProvider:
    provider_classes = {
        "GOOGLE": GoogleOAuthProvider,
        "KAKAO": KakaoOAuthProvider,
        "NAVER": NaverOAuthProvider,
    }
    provider_class = provider_classes.get(provider.upper())
    if provider_class is None:
        raise OAuthProviderError("Unsupported OAuth provider")
    return provider_class(settings or get_settings())
