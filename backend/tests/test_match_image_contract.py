from decimal import Decimal

from app.core.security import utc_now
from datetime import timedelta

from app.models import CitizenReport, DetectedObject, DetectionEvent, FoundItem, LostReport, MatchCandidate, ObjectClass
from app.services.found_item_images import representative_found_item_image_url
from app.services.mappers import found_item_list_response, match_candidate_response


def make_candidate(*, image_url: str | None) -> MatchCandidate:
    now = utc_now()
    object_class = ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now)
    detected_object = DetectedObject(id=2, detection_event_id=3, object_class_id=1, processing_status="CONFIRMED", confidence=Decimal("0.9000"), bbox_x=Decimal("1"), bbox_y=Decimal("2"), bbox_width=Decimal("30"), bbox_height=Decimal("40"), cropped_image_url=image_url, appearance_count=1, detected_at=now, created_at=now, object_class=object_class)
    found_item = FoundItem(id=4, detected_object_id=2, object_class_id=1, source_type="AI", color="검정", public_description="검정 가방", area_name="잠실", found_at=now, status="AVAILABLE", is_public=True, created_at=now, updated_at=now, object_class=object_class, detected_object=detected_object)
    lost_report = LostReport(id=5, user_id=6, object_class_id=1, color="검정", description="검정 가방", area_name="잠실", lost_from=now, status="MATCHED", created_at=now, updated_at=now, object_class=object_class)
    return MatchCandidate(id=7, lost_report_id=5, found_item_id=4, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now, lost_report=lost_report, found_item=found_item)


def test_match_response_uses_detected_object_crop_as_representative_image() -> None:
    response = match_candidate_response(make_candidate(image_url="https://storage.example/crop.jpg"))
    assert response.found_item.image_url == "https://storage.example/crop.jpg"


def test_match_response_keeps_image_optional_for_icon_fallback() -> None:
    response = match_candidate_response(make_candidate(image_url=None))
    assert response.found_item.image_url is None


def test_ai_image_falls_back_to_result_then_original_detection_media() -> None:
    candidate = make_candidate(image_url=None)
    now = utc_now()
    event = DetectionEvent(
        id=3, purpose="OPERATION", source_type="IMAGE",
        original_media_url="detections/original.png",
        result_media_url="detections/result.png",
        status="COMPLETED", captured_at=now, created_at=now, updated_at=now,
    )
    candidate.found_item.detected_object.detection_event = event

    assert representative_found_item_image_url(candidate.found_item) == "/uploads/detections/result.png"
    assert match_candidate_response(candidate).found_item.image_url == "/uploads/detections/result.png"

    event.result_media_url = None
    assert representative_found_item_image_url(candidate.found_item) == "/uploads/detections/original.png"


def test_ai_detection_media_keeps_absolute_and_upload_urls_stable() -> None:
    candidate = make_candidate(image_url=None)
    now = utc_now()
    event = DetectionEvent(
        id=3, purpose="OPERATION", source_type="IMAGE",
        original_media_url="https://storage.example/original.png",
        result_media_url="/uploads/detections/result.png",
        status="COMPLETED", captured_at=now, created_at=now, updated_at=now,
    )
    candidate.found_item.detected_object.detection_event = event

    assert representative_found_item_image_url(candidate.found_item) == "/uploads/detections/result.png"
    event.result_media_url = None
    assert representative_found_item_image_url(candidate.found_item) == "https://storage.example/original.png"


def test_citizen_image_uses_earliest_linked_report_deterministically() -> None:
    now = utc_now()
    object_class = ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now)
    item = FoundItem(id=4, object_class_id=1, source_type="CITIZEN", area_name="잠실", found_at=now, status="AVAILABLE", is_public=True, created_at=now, updated_at=now, object_class=object_class, detected_object=None)
    item.citizen_reports = [
        CitizenReport(id=12, user_id=1, object_class_id=1, description="later", image_url="/uploads/citizen/later.png", area_name="잠실", found_at=now, status="LINKED", linked_found_item_id=4, linked_at=now, created_at=now, updated_at=now),
        CitizenReport(id=11, user_id=1, object_class_id=1, description="empty", image_url=None, area_name="잠실", found_at=now, status="LINKED", linked_found_item_id=4, linked_at=now - timedelta(minutes=2), created_at=now, updated_at=now),
        CitizenReport(id=10, user_id=1, object_class_id=1, description="first", image_url="/uploads/citizen/first.png", area_name="잠실", found_at=now, status="LINKED", linked_found_item_id=4, linked_at=now - timedelta(minutes=1), created_at=now, updated_at=now),
    ]
    assert representative_found_item_image_url(item) == "/uploads/citizen/first.png"
    assert found_item_list_response(item).image_url == "/uploads/citizen/first.png"


def test_detected_crop_remains_higher_priority_than_citizen_image() -> None:
    candidate = make_candidate(image_url="/uploads/crop.jpg")
    candidate.found_item.source_type = "CITIZEN"
    candidate.found_item.citizen_reports = []
    assert representative_found_item_image_url(candidate.found_item) == "/uploads/crop.jpg"
