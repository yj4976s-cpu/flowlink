from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user as get_current_user_dependency
from app.db.session import get_db
from app.models import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.schemas.common import MessageResponse
from app.services.auth import login_user, register_user, soft_delete_user
from app.services.mappers import user_response

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=201, summary="회원가입")
def register(request: RegisterRequest, db: Annotated[Session, Depends(get_db)]) -> UserResponse:
    return register_user(db, request)


@router.post("/login", response_model=TokenResponse, summary="로그인")
def login(request: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    return login_user(db, request)


@router.post("/logout", response_model=MessageResponse, summary="로그아웃")
def logout(current_user: Annotated[User, Depends(get_current_user_dependency)]) -> MessageResponse:
    # MVP는 stateless access token만 사용하므로 서버가 토큰을 즉시 폐기하지 않는다.
    # 프론트가 보관 중인 토큰을 삭제하고, 서버 토큰은 exp 이후 자연 만료되는 구조다.
    return MessageResponse(message="Logged out")


@router.get("/me", response_model=UserResponse, summary="현재 사용자 조회")
def get_me(current_user: Annotated[User, Depends(get_current_user_dependency)]) -> UserResponse:
    return user_response(current_user)


@router.delete("/me", response_model=MessageResponse, summary="회원 탈퇴")
def delete_me(
    current_user: Annotated[User, Depends(get_current_user_dependency)],
    db: Annotated[Session, Depends(get_db)],
) -> MessageResponse:
    soft_delete_user(db, current_user)
    return MessageResponse(message="User deleted")
