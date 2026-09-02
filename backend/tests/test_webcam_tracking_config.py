from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

TRACKING_DEFAULTS = {
    "TRACK_MIN_APPEARANCES": "3",
    "TRACK_MIN_DURATION_MS": "500",
    "TRACK_MIN_MEDIAN_CONFIDENCE": "0.5",
    "TRACK_MIN_DENSITY": "0.5",
    "TRACK_MIN_DOMINANT_CLASS_RATIO": "0.7",
    "WEBCAM_TRACK_SESSION_TTL_SECONDS": "30",
    "WEBCAM_TRACK_MAX_SESSIONS": "100",
    "WEBCAM_TRACK_OBSERVATION_WINDOW": "120",
    "WEBCAM_TRACK_MAX_TRACKS": "64",
    "WEBCAM_TRACK_STALE_FRAMES": "90",
}


def _service_block(compose: str, service: str, next_service: str) -> str:
    return compose.split(f"  {service}:\n", 1)[1].split(f"  {next_service}:\n", 1)[0]


def test_webcam_tracking_environment_is_only_passed_to_backend_ai() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    backend_ai = _service_block(compose, "backend-ai", "backend-video-worker")
    other_services = compose.replace(backend_ai, "")

    for name, default in TRACKING_DEFAULTS.items():
        assert f"{name}: ${{{name}:-{default}}}" in backend_ai
        assert name not in other_services


def test_deployment_env_examples_document_all_webcam_tracking_settings() -> None:
    for relative_path in (".env.lan.example", ".env.production.example"):
        example = (ROOT / relative_path).read_text(encoding="utf-8")
        for name, default in TRACKING_DEFAULTS.items():
            assert f"{name}={default}" in example
