from collections.abc import Iterator
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.core.auth import get_optional_current_user
from app.db.session import get_db
from app.main import app
from app.services.copilot_rate_limit import CopilotRateLimiter, rate_limit_identity


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: (yield Mock())
    with TestClient(app) as value:
        yield value
    app.dependency_overrides.clear()


def test_limiter_allows_until_limit_and_isolates_keys_and_scopes() -> None:
    limiter = CopilotRateLimiter()
    assert limiter.allow("guest:peer:testclient", limit=2, window_seconds=60, now=1)
    assert limiter.allow("guest:peer:testclient", limit=2, window_seconds=60, now=2)
    assert not limiter.allow("guest:peer:testclient", limit=2, window_seconds=60, now=3)
    assert limiter.allow("user:user:7", limit=2, window_seconds=60, now=3)
    assert limiter.allow("user:user:8", limit=2, window_seconds=60, now=3)
    assert limiter.allow("guest:peer:testclient", limit=2, window_seconds=60, now=62)

    assert rate_limit_identity(None, "127.0.0.1") == ("GUEST", "guest:peer:127.0.0.1")
    assert rate_limit_identity(Mock(role="USER", id=7), "ignored") == ("USER", "user:user:7")
    assert rate_limit_identity(Mock(role="ADMIN", id=9), "ignored") == ("ADMIN", "admin:user:9")


def test_guest_chat_rate_limit_returns_safe_429_before_provider_or_tools(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    allow = Mock(return_value=False)
    provider = Mock()
    tool = Mock()
    settings = Mock(
        COPILOT_RATE_LIMIT_WINDOW_SECONDS=60,
        COPILOT_GUEST_RATE_LIMIT=10,
        COPILOT_USER_RATE_LIMIT=30,
        COPILOT_ADMIN_RATE_LIMIT=60,
    )
    monkeypatch.setattr("app.api.copilot.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.copilot.copilot_rate_limiter.allow", allow)
    monkeypatch.setattr("app.services.copilot.create_chat_provider", provider)
    monkeypatch.setattr("app.services.copilot_tools.execute_tool", tool)

    response = client.post("/api/copilot/chat", json={"messages": [{"role": "user", "content": "안녕"}], "context": {"page": "HOME", "path": "/"}})

    assert response.status_code == 429
    assert response.json()["detail"] == {"status": "RATE_LIMITED", "message": "요청이 잠시 많아요. 잠시 후 다시 시도해 주세요."}
    assert response.headers["retry-after"] == "60"
    provider.assert_not_called()
    tool.assert_not_called()


def test_logged_in_chat_rate_limit_returns_local_fallback_before_provider_or_tools(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    allow = Mock(return_value=False)
    provider = Mock()
    tool = Mock()
    settings = Mock(
        COPILOT_RATE_LIMIT_WINDOW_SECONDS=60,
        COPILOT_GUEST_RATE_LIMIT=10,
        COPILOT_USER_RATE_LIMIT=30,
        COPILOT_ADMIN_RATE_LIMIT=60,
    )
    app.dependency_overrides[get_optional_current_user] = lambda: Mock(role="USER", id=7)
    monkeypatch.setattr("app.api.copilot.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.copilot.copilot_rate_limiter.allow", allow)
    monkeypatch.setattr("app.services.copilot.create_chat_provider", provider)
    monkeypatch.setattr("app.services.copilot_tools.execute_tool", tool)

    response = client.post("/api/copilot/chat", json={"messages": [{"role": "user", "content": "매칭 알려줘"}], "context": {"page": "HOME", "path": "/"}})

    assert response.status_code == 200
    assert response.json()["provider"] == "flowlink"
    assert response.json()["model"] == "local-rate-limit"
    provider.assert_not_called()
    tool.assert_not_called()
