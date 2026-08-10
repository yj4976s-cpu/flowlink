from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG": (".jpg", "JPEG"), "PNG": (".png", "PNG"), "WEBP": (".webp", "WEBP")}


async def save_public_image(file: UploadFile | None, upload_root: Path, folder: str = "citizen") -> str | None:
    if file is None or not file.filename:
        return None
    payload = await file.read(MAX_IMAGE_BYTES + 1)
    if len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image must be 5MB or smaller")
    try:
        with Image.open(BytesIO(payload)) as probe:
            image_format = probe.format
            probe.verify()
        if image_format not in ALLOWED_IMAGE_FORMATS:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only JPEG, PNG, and WebP images are allowed")
        suffix, save_format = ALLOWED_IMAGE_FORMATS[image_format]
        with Image.open(BytesIO(payload)) as source:
            source.load()
            if save_format == "JPEG":
                clean = source.convert("RGB")
            elif source.mode not in {"RGB", "RGBA"}:
                clean = source.convert("RGBA")
            else:
                clean = source.copy()
            target_dir = upload_root / folder
            target_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid4().hex}{suffix}"
            target = target_dir / filename
            clean.save(target, format=save_format, exif=b"")
            clean.close()
            return f"/uploads/{folder}/{filename}"
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Uploaded file is not a valid image") from exc


def remove_public_image(image_url: str | None, upload_root: Path) -> None:
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
