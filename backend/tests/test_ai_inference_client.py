from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import httpx

import pytest

from app.services.ai_inference_client import AIInferenceClient, AIInferenceUnavailableError


def video_response_payload() -> dict[str, object]:
    return {
        "model_id": "flowlink-4class-hat-v7",
        "media_width": 640,
        "media_height": 360,
        "duration_ms": 1000,
        "frame_count": 30,
        "fps": 30,
        "inference_ms": 20.5,
        "tracks": [
            {
                "label": "bag",
                "confidence": 0.91,
                "bbox": {"x": 1, "y": 2, "width": 30, "height": 40},
                "track_id": 4,
                "first_seen_ms": 0,
                "last_seen_ms": 500,
                "appearance_count": 3,
            }
        ],
    }


def zip_payload(*, include_json: bool = True, include_video: bool = True, video_bytes: bytes = b"h264") -> bytes:
    payload = BytesIO()
    with ZipFile(payload, "w", compression=ZIP_DEFLATED) as bundle:
        if include_json:
            bundle.writestr("result.json", json.dumps(video_response_payload()))
        if include_video:
            bundle.writestr("result.mp4", video_bytes)
    return payload.getvalue()


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

    assert captured["url"] == "http://ai-service/api/inference/videos?render=true"
    assert captured["timeout"] == 90


def test_ai_inference_client_reads_zip_video_result(tmp_path: Path, monkeypatch) -> None:
    def fake_post(url: str, **kwargs) -> httpx.Response:
        return httpx.Response(
            200,
            content=zip_payload(video_bytes=b"rendered-video"),
            headers={"content-type": "application/zip"},
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

    result = client.infer_video_file(video_path)

    assert result.media_width == 640
    assert result.model_id == "flowlink-4class-hat-v7"
    assert result.media_height == 360
    assert result.rendered_video == b"rendered-video"
    assert result.tracks[0].model_label == "bag"
    assert result.tracks[0].track_id == 4


def test_ai_inference_client_preserves_image_model_id(monkeypatch) -> None:
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200,
            json={
                "model_id": "flowlink-4class-hat-v7",
                "media_width": 10,
                "media_height": 8,
                "inference_ms": 1.2,
                "predictions": [],
            },
        ),
    )
    client = AIInferenceClient(base_url="http://ai-service", internal_api_key="test-key", timeout_seconds=12)

    result = client.infer_image_bytes(b"image", filename="sample.jpg", content_type="image/jpeg")

    assert result.model_id == "flowlink-4class-hat-v7"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"not-a-zip", headers={"content-type": "application/zip"}),
        httpx.Response(200, content=zip_payload(include_json=False), headers={"content-type": "application/zip"}),
        httpx.Response(200, content=zip_payload(include_video=False), headers={"content-type": "application/zip"}),
        httpx.Response(200, content=zip_payload(video_bytes=b""), headers={"content-type": "application/zip"}),
    ],
)
def test_ai_inference_client_rejects_invalid_zip_video_result(
    tmp_path: Path,
    monkeypatch,
    response: httpx.Response,
) -> None:
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: response)
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"mp4")
    client = AIInferenceClient(
        base_url="http://ai-service",
        internal_api_key="test-key",
        timeout_seconds=12,
        video_timeout_seconds=90,
    )

    with pytest.raises(AIInferenceUnavailableError):
        client.infer_video_file(video_path)
