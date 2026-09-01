from io import BytesIO
from pathlib import Path
from uuid import uuid4
import warnings

import httpx
from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
NORMALIZED_MAX_EDGE = 2048
NORMALIZED_TARGET_BYTES = 2 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG": (".jpg", "JPEG"), "PNG": (".png", "PNG"), "WEBP": (".webp", "WEBP")}
SUPABASE_UPLOAD_TIMEOUT_SECONDS = 20.0


def _supabase_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.SUPABASE_URL.strip()
        and settings.SUPABASE_SERVICE_ROLE_KEY.strip()
        and settings.SUPABASE_STORAGE_BUCKET.strip()
    )


def _supabase_public_url(object_key: str) -> str:
    settings = get_settings()
    base_url = settings.SUPABASE_URL.strip().rstrip("/")
    bucket = settings.SUPABASE_STORAGE_BUCKET.strip().strip("/")
    return f"{base_url}/storage/v1/object/public/{bucket}/{object_key}"


async def _upload_to_supabase(object_key: str, payload: bytes, content_type: str) -> str:
    settings = get_settings()
    base_url = settings.SUPABASE_URL.strip().rstrip("/")
    service_key = settings.SUPABASE_SERVICE_ROLE_KEY.strip()
    bucket = settings.SUPABASE_STORAGE_BUCKET.strip().strip("/")
    upload_url = f"{base_url}/storage/v1/object/{bucket}/{object_key}"
    headers = {
        "apikey": service_key,
        "authorization": f"Bearer {service_key}",
        "content-type": content_type,
        "x-upsert": "false",
    }

    try:
        async with httpx.AsyncClient(timeout=SUPABASE_UPLOAD_TIMEOUT_SECONDS) as client:
            response = await client.post(upload_url, content=payload, headers=headers)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Image storage upload failed") from exc

    return _supabase_public_url(object_key)


def _verify_public_image_dimensions(image: Image.Image) -> None:
    width, height = image.size
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Uploaded file is not a valid image")
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Image dimensions are too large")


async def save_public_image(file: UploadFile | None, upload_root: Path, folder: str = "citizen") -> str | None:
    if file is None or not file.filename:
        return None
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type in {"image/heic", "image/heif"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="HEIC/HEIF images are not supported. Please upload JPG, PNG, or WebP.",
        )
    payload = await file.read(MAX_IMAGE_BYTES + 1)
    if len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Image must be 5MB or smaller")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as probe:
                image_format = probe.format
                _verify_public_image_dimensions(probe)
                if getattr(probe, "is_animated", False) and image_format == "WEBP":
                    raise HTTPException(
                        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                        detail="Animated WebP images are not supported.",
                    )
                probe.verify()
        if image_format not in ALLOWED_IMAGE_FORMATS:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only JPEG, PNG, and WebP images are allowed")
        suffix, save_format = ALLOWED_IMAGE_FORMATS[image_format]
        normalized: Image.Image | None = None
        clean: Image.Image | None = None
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as source:
                _verify_public_image_dimensions(source)
                if getattr(source, "is_animated", False) and source.format == "WEBP":
                    raise HTTPException(
                        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                        detail="Animated WebP images are not supported.",
                    )
                source.load()
                normalized = ImageOps.exif_transpose(source).copy()
        try:
            if save_format == "JPEG":
                clean = normalized.convert("RGB")
            elif normalized.mode not in {"RGB", "RGBA"}:
                clean = normalized.convert("RGBA")
            else:
                clean = normalized.copy()
            if clean.width > NORMALIZED_MAX_EDGE or clean.height > NORMALIZED_MAX_EDGE:
                resized = clean.copy()
                resized.thumbnail((NORMALIZED_MAX_EDGE, NORMALIZED_MAX_EDGE), Image.Resampling.LANCZOS)
                clean.close()
                clean = resized
            output = BytesIO()
            save_kwargs = {"exif": b""}
            if save_format == "JPEG":
                save_kwargs.update({"quality": 86, "optimize": True})
            elif save_format == "WEBP":
                save_kwargs.update({"quality": 86, "method": 4})
            clean.save(output, format=save_format, **save_kwargs)
            payload_to_store = output.getvalue()
            content_type = f"image/{'jpeg' if save_format == 'JPEG' else save_format.lower()}"
            if len(payload_to_store) > NORMALIZED_TARGET_BYTES:
                rgb = clean.convert("RGB")
                try:
                    for quality in (82, 76, 70, 64, 58):
                        output = BytesIO()
                        rgb.save(output, format="JPEG", quality=quality, optimize=True, exif=b"")
                        payload_to_store = output.getvalue()
                        if len(payload_to_store) <= NORMALIZED_TARGET_BYTES:
                            break
                    suffix = ".jpg"
                    save_format = "JPEG"
                    content_type = "image/jpeg"
                finally:
                    rgb.close()
            if len(payload_to_store) > NORMALIZED_TARGET_BYTES:
                raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Image cannot be optimized under 2MB")
            filename = f"{uuid4().hex}{suffix}"
            if _supabase_configured():
                object_key = f"{folder.strip('/')}/{filename}"
                return await _upload_to_supabase(object_key, payload_to_store, content_type)
            target_dir = upload_root / folder
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / filename
            target.write_bytes(payload_to_store)
            return f"/uploads/{folder}/{filename}"
        finally:
            if clean is not None:
                clean.close()
            if normalized is not None:
                normalized.close()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="Image dimensions are too large") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Uploaded file is not a valid image") from exc


def remove_public_image(image_url: str | None, upload_root: Path) -> None:
    if image_url and _supabase_configured():
        public_prefix = _supabase_public_url("").rstrip("/")
        if image_url.startswith(f"{public_prefix}/"):
            object_key = image_url.removeprefix(f"{public_prefix}/")
            settings = get_settings()
            base_url = settings.SUPABASE_URL.strip().rstrip("/")
            bucket = settings.SUPABASE_STORAGE_BUCKET.strip().strip("/")
            service_key = settings.SUPABASE_SERVICE_ROLE_KEY.strip()
            try:
                httpx.delete(
                    f"{base_url}/storage/v1/object/{bucket}/{object_key}",
                    headers={"apikey": service_key, "authorization": f"Bearer {service_key}"},
                    timeout=SUPABASE_UPLOAD_TIMEOUT_SECONDS,
                )
            except httpx.HTTPError:
                pass
            return
    if not image_url or not image_url.startswith("/uploads/"):
        return
    relative = Path(image_url.removeprefix("/uploads/"))
    target = (upload_root / relative).resolve()
    root = upload_root.resolve()
    if root in target.parents and target.is_file():
        try:
            target.unlink()
        except OSError:
            # Cleanup must not replace the original report-creation error.
            pass
