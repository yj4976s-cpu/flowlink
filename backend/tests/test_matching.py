from datetime import timedelta

from app.core.security import utc_now
from app.models import FoundItem, LostReport
from app.services.matching import MATCH_THRESHOLD, calculate_match_score


def make_lost_report(**overrides: object) -> LostReport:
    values = {
        "id": 1,
        "user_id": 10,
        "object_class_id": 11,
        "color": "검정",
        "description": "검정 백팩 노트북 파우치",
        "area_name": "잠실 한강공원",
        "lost_from": utc_now(),
        "status": "OPEN",
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    values.update(overrides)
    return LostReport(**values)


def make_found_item(**overrides: object) -> FoundItem:
    values = {
        "id": 20,
        "object_class_id": 11,
        "color": "검정",
        "public_description": "검정 백팩 발견",
        "area_name": "잠실 한강공원",
        "found_at": utc_now() + timedelta(days=1),
        "status": "AVAILABLE",
        "is_public": True,
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    values.update(overrides)
    return FoundItem(**values)


def test_same_type_scores_and_total_is_sum() -> None:
    score = calculate_match_score(make_lost_report(), make_found_item())

    assert score is not None
    assert score.type_score == 40
    assert score.area_score == 25
    assert score.time_score == 20
    assert score.keyword_score == 12
    assert score.total_score == 97


def test_different_type_is_excluded() -> None:
    assert calculate_match_score(make_lost_report(object_class_id=11), make_found_item(object_class_id=12)) is None


def test_area_score_requires_normalized_exact_match() -> None:
    score = calculate_match_score(make_lost_report(area_name=" 잠실 한강공원 "), make_found_item(area_name="잠실 한강공원"))

    assert score is not None
    assert score.area_score == 25


def test_time_score_boundaries() -> None:
    lost_at = utc_now()

    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at - timedelta(seconds=1))) is None
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=7))).time_score == 20
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=30))).time_score == 10
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=31))).time_score == 0


def test_color_and_keyword_score() -> None:
    score = calculate_match_score(
        make_lost_report(color="검정", description="검정 백팩 노트북 파우치"),
        make_found_item(color=" 검정", public_description="검정 백팩 발견"),
    )

    assert score is not None
    assert score.keyword_score == 12


def test_threshold_value() -> None:
    assert MATCH_THRESHOLD == 60
