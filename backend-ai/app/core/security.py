from secrets import compare_digest
from typing import Annotated

from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def require_internal_api_key(
    api_key: Annotated[str | None, Header(alias="X-Internal-API-Key")] = None,
) -> None:
    configured_key = get_settings().AI_INTERNAL_API_KEY
    if not configured_key or api_key is None or not compare_digest(api_key, configured_key):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
