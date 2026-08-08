from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User
from app.repositories.user_flow import get_user_by_id

bearer_scheme = HTTPBearer(auto_error=False)


def ensure_active_user(user: User | None) -> User:
    if user is None or not user.active or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def ensure_admin(user: User) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin permission required")
    return user


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return ensure_active_user(get_user_by_id(db, user_id))


def require_admin(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    return ensure_admin(current_user)
