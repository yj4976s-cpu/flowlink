from fastapi import APIRouter, HTTPException, status

from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


def not_implemented() -> None:
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")


@router.post("/register", response_model=MessageResponse, summary="회원가입")
def register(request: RegisterRequest) -> None:
    not_implemented()


@router.post("/login", response_model=MessageResponse, summary="로그인")
def login(request: LoginRequest) -> None:
    not_implemented()


@router.post("/logout", response_model=MessageResponse, summary="로그아웃")
def logout() -> None:
    # TODO: Add JWT authentication dependency.
    not_implemented()


@router.get("/me", response_model=MessageResponse, summary="현재 사용자 조회")
def get_current_user() -> None:
    # TODO: Add JWT authentication dependency.
    not_implemented()
