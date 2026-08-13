import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def disable_remote_image_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(settings, "SUPABASE_STORAGE_BUCKET", "")
    monkeypatch.setattr(settings, "KAKAO_REST_API_KEY", "")
