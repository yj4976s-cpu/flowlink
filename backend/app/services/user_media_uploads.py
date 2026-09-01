from __future__ import annotations

import json
import math
import shutil
import subprocess
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings
from app.models import User

UPLOAD_CHUNK_BYTES = 1024 * 1024
IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_CONTENT_TYPES = {"video/mp4"}
HEIC_CONTENT_TYPES = {"image/heic", "image/heif"}


def user_detection_key(current_user: User, suffix: str) -> Path:
    return Path("detections") / "user" / str(current_user.id) / f"{uuid4().hex}{suffix}"


def resolve_destination(upload_root: Path, relative_key: Path) -> Path:
    destination = (upload_root / relative_key).resolve()
    if not destination.is_relative_to(upload_root):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload path")
    destination.parent.mkdir(parents=True, exist_ok=True)
    return destination


async def read_limited_upload(upload: UploadFile, *, max_bytes: int) -> bytes:
    total_bytes = 0
    chunks: list[bytes] = []
    while chunk := await upload.read(UPLOAD_CHUNK_BYTES):
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Uploaded file is too large")
        chunks.append(chunk)
    if total_bytes == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    return b"".join(chunks)


def _is_animated_webp(image: Image.Image) -> bool:
    return image.format == "WEBP" and getattr(image, "is_animated", False) and getattr(image, "n_frames", 1) > 1


def _to_clean_rgb(image: Image.Image) -> Image.Image:
    normalized = ImageOps.exif_transpose(image)
    try:
        if normalized.mode in {"RGBA", "LA"} or ("transparency" in normalized.info):
            rgba = normalized.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            background.alpha_composite(rgba)
            rgba.close()
            return background.convert("RGB")
        return normalized.convert("RGB")
    finally:
        if normalized is not image:
            normalized.close()


def _resize_to_max_edge(image: Image.Image, *, max_edge: int) -> Image.Image:
    if image.width <= max_edge and image.height <= max_edge:
        return image.copy()
    resized = image.copy()
    resized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    return resized


def _encode_jpeg_under_limits(image: Image.Image, *, target_bytes: int, hard_max_bytes: int, max_edge: int) -> bytes:
    edge_candidates = [max_edge, 2304, 2048, 1800, 1600, 1400, 1280, 1024]
    quality_candidates = [88, 84, 80, 76, 72, 68, 64, 60]
    best_payload: bytes | None = None
    for edge in edge_candidates:
        if edge > max_edge:
            continue
        candidate = _resize_to_max_edge(image, max_edge=edge)
        try:
            for quality in quality_candidates:
                output = BytesIO()
                candidate.save(output, format="JPEG", quality=quality, optimize=True, progressive=True, exif=b"")
                payload = output.getvalue()
                if len(payload) <= target_bytes:
                    return payload
                if len(payload) <= hard_max_bytes and (best_payload is None or len(payload) < len(best_payload)):
                    best_payload = payload
        finally:
            candidate.close()
    if best_payload is not None:
        return best_payload
    raise HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail="Image cannot be optimized under the server storage limit.",
    )


async def save_normalized_user_image(
    upload: UploadFile,
    *,
    current_user: User,
    upload_root: Path,
    settings: Settings,
) -> tuple[Path, str, int]:
    content_type = (upload.content_type or "").lower()
    if content_type in HEIC_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="HEIC/HEIF images are not supported. Please upload JPG, PNG, or WebP.")
    if content_type not in IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only JPG, PNG, and WebP images are supported.")

    payload = await read_limited_upload(upload, max_bytes=settings.USER_IMAGE_SOURCE_MAX_BYTES)
    try:
        with Image.open(BytesIO(payload)) as probe:
            if _is_animated_webp(probe):
                raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Animated WebP images are not supported.")
            probe.verify()
        with Image.open(BytesIO(payload)) as source:
            source.load()
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only JPG, PNG, and WebP images are supported.")
            if source.width <= 0 or source.height <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image dimensions")
            if source.width * source.height > settings.USER_IMAGE_SOURCE_MAX_PIXELS:
                raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Image dimensions are too large.")
            clean = _to_clean_rgb(source)
            try:
                normalized_payload = _encode_jpeg_under_limits(
                    clean,
                    target_bytes=settings.USER_IMAGE_NORMALIZED_TARGET_BYTES,
                    hard_max_bytes=settings.USER_IMAGE_NORMALIZED_HARD_MAX_BYTES,
                    max_edge=settings.USER_IMAGE_NORMALIZED_MAX_EDGE,
                )
            finally:
                clean.close()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Uploaded file is not a valid image") from exc

    relative_key = user_detection_key(current_user, ".jpg")
    destination = resolve_destination(upload_root, relative_key)
    try:
        destination.write_bytes(normalized_payload)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return destination, relative_key.as_posix(), len(normalized_payload)


def _ffmpeg_bin(name: str) -> str:
    executable = shutil.which(name)
    if not executable:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{name} is not configured")
    return executable


def _run_command(command: list[str], *, timeout: float) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, shell=False, capture_output=True, text=True, timeout=timeout, check=False)


def _parse_rate(value: str | None) -> float | None:
    if not value or value == "0/0":
        return None
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            denominator_value = float(denominator)
            if denominator_value == 0:
                return None
            return float(numerator) / denominator_value
        except ValueError:
            return None
    try:
        return float(value)
    except ValueError:
        return None


def ffprobe_video(path: Path, *, settings: Settings) -> dict[str, float | int | str | None]:
    ffprobe = _ffmpeg_bin("ffprobe")
    result = _run_command(
        [
            ffprobe,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        timeout=settings.USER_VIDEO_FFPROBE_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Uploaded file is not a valid MP4 video")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Uploaded file is not a valid MP4 video") from exc
    video_stream = next((stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"), None)
    if not video_stream:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Uploaded file does not contain a video stream")
    width = int(video_stream.get("width") or 0)
    height = int(video_stream.get("height") or 0)
    duration = float(video_stream.get("duration") or payload.get("format", {}).get("duration") or 0)
    fps = _parse_rate(video_stream.get("avg_frame_rate")) or _parse_rate(video_stream.get("r_frame_rate"))
    return {
        "format_name": str(payload.get("format", {}).get("format_name") or ""),
        "width": width,
        "height": height,
        "duration": duration,
        "fps": fps,
    }


def validate_video_probe(probe: dict[str, float | int | str | None], *, settings: Settings) -> None:
    format_name = str(probe.get("format_name") or "")
    if not any(name in format_name.split(",") for name in {"mp4", "mov", "m4a", "3gp", "3g2", "mj2"}):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only MP4 videos are supported.")
    width = int(probe.get("width") or 0)
    height = int(probe.get("height") or 0)
    duration = float(probe.get("duration") or 0)
    if width <= 0 or height <= 0 or not math.isfinite(duration) or duration <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid video metadata")
    if duration > settings.USER_VIDEO_MAX_DURATION_SECONDS:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Video must be 30 seconds or shorter.")
    if max(width, height) > settings.USER_VIDEO_MAX_SOURCE_EDGE:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Video dimensions are too large.")


def normalize_video_to_mp4(raw_path: Path, destination: Path, *, source_probe: dict[str, float | int | str | None], settings: Settings) -> None:
    ffmpeg = _ffmpeg_bin("ffmpeg")
    source_fps = float(source_probe.get("fps") or 0)
    filters = [
        (
            f"scale='min({settings.USER_VIDEO_NORMALIZED_MAX_WIDTH},iw)':"
            f"'min({settings.USER_VIDEO_NORMALIZED_MAX_HEIGHT},ih)':"
            "force_original_aspect_ratio=decrease:force_divisible_by=2"
        )
    ]
    if source_fps <= 0 or source_fps > settings.USER_VIDEO_NORMALIZED_MAX_FPS:
        filters.append(f"fps={settings.USER_VIDEO_NORMALIZED_MAX_FPS}")
    temp_output = destination.with_name(f"{destination.stem}.normalized.tmp{destination.suffix}")
    temp_output.unlink(missing_ok=True)
    result = _run_command(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(raw_path),
            "-an",
            "-vf",
            ",".join(filters),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(temp_output),
        ],
        timeout=settings.USER_VIDEO_FFMPEG_TIMEOUT_SECONDS,
    )
    if result.returncode != 0 or not temp_output.exists() or temp_output.stat().st_size <= 0:
        temp_output.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Video normalization failed")
    temp_output.replace(destination)


async def save_normalized_user_video(
    upload: UploadFile,
    *,
    current_user: User,
    upload_root: Path,
    settings: Settings,
) -> tuple[Path, str, int]:
    content_type = (upload.content_type or "").lower()
    if content_type not in VIDEO_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only MP4 videos are supported.")
    relative_key = user_detection_key(current_user, ".mp4")
    destination = resolve_destination(upload_root, relative_key)
    raw_path = destination.with_name(f"{destination.stem}.upload.tmp.mp4")
    raw_path.unlink(missing_ok=True)
    try:
        with raw_path.open("wb") as output:
            total_bytes = 0
            while chunk := await upload.read(UPLOAD_CHUNK_BYTES):
                total_bytes += len(chunk)
                if total_bytes > settings.USER_VIDEO_MAX_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Video is larger than the upload limit.")
                output.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
        source_probe = ffprobe_video(raw_path, settings=settings)
        validate_video_probe(source_probe, settings=settings)
        normalize_video_to_mp4(raw_path, destination, source_probe=source_probe, settings=settings)
        output_probe = ffprobe_video(destination, settings=settings)
        validate_video_probe(output_probe, settings=settings)
        return destination, relative_key.as_posix(), destination.stat().st_size
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        raw_path.unlink(missing_ok=True)
