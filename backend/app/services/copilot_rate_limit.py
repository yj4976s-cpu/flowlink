from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from app.core.config import Settings
from app.models import User


class CopilotRateLimiter:
    """Small process-local limiter; replace this boundary for shared multi-worker storage."""

    def __init__(self) -> None:
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, *, limit: int, window_seconds: int, now: float | None = None) -> bool:
        current = monotonic() if now is None else now
        cutoff = current - window_seconds
        with self._lock:
            requests = self._requests[key]
            while requests and requests[0] <= cutoff:
                requests.popleft()
            if len(requests) >= limit:
                return False
            requests.append(current)
            return True

    def clear(self) -> None:
        with self._lock:
            self._requests.clear()


def rate_limit_identity(user: User | None, client_host: str | None) -> tuple[str, str]:
    if user is not None:
        role = "ADMIN" if user.role == "ADMIN" else "USER"
        return role, f"{role.lower()}:user:{user.id}"
    # Deliberately use the ASGI peer address. X-Forwarded-For is not trusted without proxy configuration.
    return "GUEST", f"guest:peer:{client_host or 'unknown'}"


def role_limit(settings: Settings, role: str) -> int:
    if role == "ADMIN":
        return settings.COPILOT_ADMIN_RATE_LIMIT
    if role == "USER":
        return settings.COPILOT_USER_RATE_LIMIT
    return settings.COPILOT_GUEST_RATE_LIMIT


copilot_rate_limiter = CopilotRateLimiter()
