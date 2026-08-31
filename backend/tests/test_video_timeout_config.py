from pathlib import Path

from app.core.config import Settings


ROOT = Path(__file__).parents[2]


def test_video_timeout_defaults_leave_a_stale_job_safety_window() -> None:
    settings = Settings(_env_file=None)

    assert settings.AI_VIDEO_SERVICE_TIMEOUT_SECONDS == 300
    assert settings.VIDEO_JOB_STALE_SECONDS == 600
    assert settings.VIDEO_JOB_STALE_SECONDS > settings.AI_VIDEO_SERVICE_TIMEOUT_SECONDS


def test_video_timeout_defaults_match_runtime_examples() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    env_example = (ROOT / "backend" / ".env.example").read_text(encoding="utf-8")
    deployment_examples = [
        (ROOT / ".env.lan.example").read_text(encoding="utf-8"),
        (ROOT / ".env.production.example").read_text(encoding="utf-8"),
    ]

    assert "AI_VIDEO_SERVICE_TIMEOUT_SECONDS:-300" in compose
    assert "VIDEO_JOB_STALE_SECONDS:-600" in compose
    assert "AI_VIDEO_SERVICE_TIMEOUT_SECONDS=300" in env_example
    assert "VIDEO_JOB_STALE_SECONDS=600" in env_example
    for deployment_example in deployment_examples:
        assert "AI_VIDEO_SERVICE_TIMEOUT_SECONDS=300" in deployment_example
        assert "VIDEO_JOB_STALE_SECONDS=600" in deployment_example
        assert "AI_VIDEO_SERVICE_TIMEOUT_SECONDS=120" not in deployment_example
