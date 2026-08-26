from ipaddress import ip_address, ip_network
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user as get_current_user_dependency
from app.core.config import get_settings
from app.db.session import get_db
from app.models import User
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    NicknameUpdateRequest,
    PasswordChangeRequest,
    RegisterRequest,
    UserResponse,
)
from app.schemas.common import MessageResponse
from app.services.auth import (
    change_password,
    login_user,
    register_and_login_user,
    soft_delete_user,
    update_nickname,
)
from app.services.mappers import user_response

router = APIRouter(prefix="/api/auth", tags=["auth"])

INTERNAL_HTTP_NETWORKS = tuple(
    ip_network(network)
    for network in (
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
    )
)


def _forwarded_header_value(value: str | None) -> str | None:
    if not value:
        return None
    return value.split(",", 1)[0].strip()


def _host_without_port(value: str | None) -> str:
    host = (_forwarded_header_value(value) or "").lower().rstrip(".")
    if host.startswith("["):
        return host.split("]", 1)[0].lstrip("[")
    return host.rsplit(":", 1)[0]


def _is_internal_http_host(host: str) -> bool:
    if host in {"localhost", "127.0.0.1"}:
        return True
    try:
        address = ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or any(address in network for network in INTERNAL_HTTP_NETWORKS)


def _is_trusted_proxy(client_host: str | None) -> bool:
    if not client_host:
        return False
    settings = get_settings()
    allowed = [entry.strip() for entry in settings.FORWARDED_ALLOW_IPS.split(",") if entry.strip()]
    if not allowed:
        return not settings._is_production
    try:
        client_address = ip_address(client_host)
    except ValueError:
        return client_host in allowed
    for entry in allowed:
        try:
            if "/" in entry and client_address in ip_network(entry, strict=False):
                return True
            if client_address == ip_address(entry):
                return True
        except ValueError:
            continue
    return False


def should_use_secure_cookie(request: Request) -> bool:
    settings = get_settings()
    client_host = request.client.host if request.client else None
    trust_forwarded = _is_trusted_proxy(client_host)
    proto = request.url.scheme.lower()
    host = _host_without_port(request.url.hostname)
    if trust_forwarded:
        proto = (
            _forwarded_header_value(request.headers.get("x-forwarded-proto"))
            or proto
        ).lower()
        host = _host_without_port(
            request.headers.get("x-forwarded-host")
            or request.headers.get("host")
            or host
        )

    if proto == "https":
        return True
    if not settings._is_production:
        return False
    if proto == "http" and (
        _is_internal_http_host(host) or host in settings.insecure_http_hosts
    ):
        return False
    return True


def set_login_cookie(
    response: Response,
    request: Request,
    access_token: str,
    expires_in: int,
) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=access_token,
        max_age=expires_in,
        httponly=True,
        secure=should_use_secure_cookie(request),
        samesite="lax",
        path="/",
    )


def delete_login_cookie(response: Response, request: Request) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.AUTH_COOKIE_NAME,
        secure=should_use_secure_cookie(request),
        httponly=True,
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=UserResponse, status_code=201, summary="회원가입")
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    result = register_and_login_user(db, payload)
    set_login_cookie(response, request, result.access_token, result.expires_in)
    return result.user


@router.post("/login", response_model=LoginResponse, summary="로그인")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> LoginResponse:
    result = login_user(db, payload)
    set_login_cookie(response, request, result.access_token, result.expires_in)
    return LoginResponse(expires_in=result.expires_in, user=result.user)


@router.post("/logout", response_model=MessageResponse, summary="로그아웃")
def logout(request: Request, response: Response) -> MessageResponse:
    delete_login_cookie(response, request)
    return MessageResponse(message="Logged out")


@router.get("/me", response_model=UserResponse, summary="현재 사용자 조회")
def get_me(current_user: Annotated[User, Depends(get_current_user_dependency)]) -> UserResponse:
    return user_response(current_user)


@router.patch("/me", response_model=UserResponse, summary="닉네임 수정")
def patch_me(
    request: NicknameUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user_dependency)],
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    return update_nickname(db, current_user, request.nickname)


@router.patch("/me/password", response_model=MessageResponse, summary="비밀번호 변경")
def patch_password(
    request: PasswordChangeRequest,
    current_user: Annotated[User, Depends(get_current_user_dependency)],
    db: Annotated[Session, Depends(get_db)],
) -> MessageResponse:
    change_password(db, current_user, request.current_password, request.new_password)
    return MessageResponse(message="Password changed")


@router.delete("/me", response_model=MessageResponse, summary="회원 탈퇴")
def delete_me(
    request: Request,
    response: Response,
    current_user: Annotated[User, Depends(get_current_user_dependency)],
    db: Annotated[Session, Depends(get_db)],
) -> MessageResponse:
    soft_delete_user(db, current_user)
    delete_login_cookie(response, request)
    return MessageResponse(message="User deleted")
