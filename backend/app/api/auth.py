from typing import Annotated

from fastapi import APIRouter, Depends, Response
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


def set_login_cookie(response: Response, access_token: str, expires_in: int) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=access_token,
        max_age=expires_in,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


def delete_login_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.AUTH_COOKIE_NAME,
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=UserResponse, status_code=201, summary="회원가입")
def register(
    request: RegisterRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    result = register_and_login_user(db, request)
    set_login_cookie(response, result.access_token, result.expires_in)
    return result.user


@router.post("/login", response_model=LoginResponse, summary="로그인")
def login(request: LoginRequest, response: Response, db: Annotated[Session, Depends(get_db)]) -> LoginResponse:
    result = login_user(db, request)
    set_login_cookie(response, result.access_token, result.expires_in)
    return LoginResponse(expires_in=result.expires_in, user=result.user)


@router.post("/logout", response_model=MessageResponse, summary="로그아웃")
def logout(response: Response) -> MessageResponse:
    delete_login_cookie(response)
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
    response: Response,
    current_user: Annotated[User, Depends(get_current_user_dependency)],
    db: Annotated[Session, Depends(get_db)],
) -> MessageResponse:
    soft_delete_user(db, current_user)
    delete_login_cookie(response)
    return MessageResponse(message="User deleted")
