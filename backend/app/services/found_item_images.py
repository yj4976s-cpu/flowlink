from __future__ import annotations

from app.models import FoundItem


def representative_found_item_image_url(found_item: FoundItem) -> str | None:
    detected = found_item.detected_object
    if detected is not None and detected.cropped_image_url and detected.cropped_image_url.strip():
        return detected.cropped_image_url
    if found_item.source_type != "CITIZEN":
        return None
    reports = (
        report for report in found_item.citizen_reports
        if report.linked_found_item_id == found_item.id and report.image_url and report.image_url.strip()
    )
    representative = min(reports, key=lambda report: (report.linked_at is None, report.linked_at or report.created_at, report.id), default=None)
    return representative.image_url if representative is not None else None
