from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    hash_password,
    normalize_email,
    utc_now,
    verify_password,
)
from app.models import User
from app.repositories.user_flow import clean_optional_text, get_user_by_email
from app.schemas.auth import LoginRequest, RegisterRequest, UserResponse
from app.services.mappers import user_response


@dataclass(frozen=True)
class LoginResult:
    access_token: str
    expires_in: int
    user: UserResponse


def _release_deleted_email(user: User) -> None:
    if user.active or user.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    # 탈퇴 이력의 FK는 보존하되 로그인 식별자는 비식별화해 같은 이메일로 새 계정을 만들 수 있게 한다.
    user.email = f"deleted-user-{user.id}@flowlink.invalid"
    user.updated_at = utc_now()


def validate_registration_agreements(request: RegisterRequest) -> None:
    if not request.terms_agreed or not request.privacy_agreed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Terms and privacy agreements are required",
        )


def register_user(db: Session, request: RegisterRequest) -> UserResponse:
    validate_registration_agreements(request)
    email = normalize_email(str(request.email))
    nickname = clean_optional_text(request.nickname)
    if nickname is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nickname is required")

    existing_user = get_user_by_email(db, email)
    if existing_user is not None:
        _release_deleted_email(existing_user)

    now = utc_now()
    user = User(
        email=email,
        password_hash=hash_password(request.password),
        nickname=nickname,
        # role은 클라이언트 입력으로 받지 않는다. 가입 요청자가 ADMIN을 자체 부여하는 권한 상승을 막기 위함이다.
        role="USER",
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # DB의 LOWER(email) unique index와 애플리케이션 중복 검사를 함께 사용해 동시 가입 경쟁을 막는다.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered") from exc
    db.refresh(user)
    return user_response(user)


def login_user(db: Session, request: LoginRequest) -> LoginResult:
    email = normalize_email(str(request.email))
    user = get_user_by_email(db, email)
    if (
        user is None
        or not user.active
        or user.deleted_at is not None
        or not verify_password(request.password, user.password_hash)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    user.last_login_at = utc_now()
    db.commit()
    db.refresh(user)
    access_token, expires_in = create_access_token(user.id, user.role)
    return LoginResult(
        access_token=access_token,
        expires_in=expires_in,
        user=user_response(user),
    )


def register_and_login_user(db: Session, request: RegisterRequest) -> LoginResult:
    validate_registration_agreements(request)
    email = normalize_email(str(request.email))
    nickname = clean_optional_text(request.nickname)
    if nickname is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nickname is required")
    existing_user = get_user_by_email(db, email)
    if existing_user is not None:
        _release_deleted_email(existing_user)

    now = utc_now()
    user = User(
        email=email,
        password_hash=hash_password(request.password),
        nickname=nickname,
        role="USER",
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
        last_login_at=now,
    )
    db.add(user)
    try:
        db.flush()
        access_token, expires_in = create_access_token(user.id, user.role)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered") from exc
    except Exception:
        db.rollback()
        raise

    db.refresh(user)
    return LoginResult(
        access_token=access_token,
        expires_in=expires_in,
        user=user_response(user),
    )


def soft_delete_user(db: Session, user: User) -> None:
    if not user.active or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already deleted")

    now = utc_now()
    # 개인정보 처리는 즉시 물리 삭제보다 soft delete를 우선한다.
    # 신고/소유권 기록의 참조 무결성을 유지하면서 이후 보호 API 접근은 active=false로 차단한다.
    user.active = False
    user.deleted_at = now
    user.email = f"deleted-user-{user.id}@flowlink.invalid"
    user.updated_at = now
    db.commit()


def update_nickname(db: Session, user: User, nickname: str) -> UserResponse:
    normalized = clean_optional_text(nickname)
    if normalized is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nickname is required")
    user.nickname = normalized
    user.updated_at = utc_now()
    db.commit()
    db.refresh(user)
    return user_response(user)


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.password_hash = hash_password(new_password)
    user.updated_at = utc_now()
    db.commit()
