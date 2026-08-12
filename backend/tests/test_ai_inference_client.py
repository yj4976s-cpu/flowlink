from __future__ import annotations

from pathlib import Path

import httpx

from app.services.ai_inference_client import AIInferenceClient


def test_ai_inference_client_uses_image_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs) -> httpx.Response:
        captured["url"] = url
        captured["timeout"] = kwargs["timeout"]
        return httpx.Response(
            200,
            json={
                "media_width": 10,
                "media_height": 8,
                "inference_ms": 1.2,
                "predictions": [],
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    client = AIInferenceClient(
        base_url="http://ai-service",
        internal_api_key="test-key",
        timeout_seconds=12,
        video_timeout_seconds=90,
    )

    client.infer_image_bytes(b"image", filename="sample.jpg", content_type="image/jpeg")

    assert captured["url"] == "http://ai-service/api/inference/images"
    assert captured["timeout"] == 12


def test_ai_inference_client_uses_video_timeout(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs) -> httpx.Response:
        captured["url"] = url
        captured["timeout"] = kwargs["timeout"]
        return httpx.Response(
            200,
            json={
                "media_width": 640,
                "media_height": 360,
                "duration_ms": 1000,
                "frame_count": 30,
                "fps": 30,
                "inference_ms": 20.5,
                "tracks": [],
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"mp4")
    client = AIInferenceClient(
        base_url="http://ai-service",
        internal_api_key="test-key",
        timeout_seconds=12,
        video_timeout_seconds=90,
    )

    client.infer_video_file(video_path)

    assert captured["url"] == "http://ai-service/api/inference/videos"
    assert captured["timeout"] == 90
