from __future__ import annotations

import argparse
from pathlib import Path

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import DetectionEvent
from app.repositories.detections import USER_ANALYSIS_PURPOSE


def _resolve_upload_root() -> Path:
    configured = Path(get_settings().UPLOAD_DIR)
    root = configured if configured.is_absolute() else Path(__file__).resolve().parents[1] / configured
    return root.resolve()


def _safe_media_path(upload_root: Path, media_url: str | None) -> Path | None:
    if not media_url:
        return None
    relative = media_url.removeprefix("/uploads/")
    candidate = (upload_root / relative).resolve()
    if not candidate.is_relative_to(upload_root):
        return None
    return candidate


def backfill_detection_media_bytes(*, dry_run: bool) -> tuple[int, int]:
    upload_root = _resolve_upload_root()
    inspected = 0
    updated = 0
    with SessionLocal() as db:
        events = (
            db.query(DetectionEvent)
            .filter(
                DetectionEvent.purpose == USER_ANALYSIS_PURPOSE,
                (
                    DetectionEvent.original_media_bytes.is_(None)
                    | (
                        DetectionEvent.result_media_url.is_not(None)
                        & DetectionEvent.result_media_bytes.is_(None)
                    )
                ),
            )
            .all()
        )
        for event in events:
            inspected += 1
            changed = False
            original = _safe_media_path(upload_root, event.original_media_url)
            if event.original_media_bytes is None and original is not None and original.is_file():
                event.original_media_bytes = original.stat().st_size
                changed = True
            result = _safe_media_path(upload_root, event.result_media_url)
            if event.result_media_url and event.result_media_bytes is None and result is not None and result.is_file():
                event.result_media_bytes = result.stat().st_size
                changed = True
            if changed:
                updated += 1
        if dry_run:
            db.rollback()
        else:
            db.commit()
    return inspected, updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill USER_ANALYSIS detection media byte columns from existing upload files.")
    parser.add_argument("--apply", action="store_true", help="write discovered byte sizes to the database")
    args = parser.parse_args()
    inspected, updated = backfill_detection_media_bytes(dry_run=not args.apply)
    mode = "apply" if args.apply else "dry-run"
    print(f"{mode}: inspected={inspected} updated={updated}")


if __name__ == "__main__":
    main()
