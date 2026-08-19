from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.core.security import utc_now
from app.models import FoundItem, LostReport, MatchCandidate
from app.services.matching import (
    MATCH_THRESHOLD,
    ColorEvaluation,
    FeatureEvaluation,
    LocationEvidenceSource,
    MatchRejectionReason,
    calculate_distance_km,
    calculate_match_score,
    candidate_rank_key,
    evaluate_color,
    evaluate_features,
    evaluate_location,
    evaluate_match_candidate,
    evaluate_time,
    location_score_for_distance,
)


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
        "source_type": "ADMIN",
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
    assert score.keyword_score == 11
    assert score.total_score == 96


def test_different_type_is_excluded() -> None:
    assert calculate_match_score(make_lost_report(object_class_id=11), make_found_item(object_class_id=12)) is None


def test_area_score_requires_normalized_exact_match() -> None:
    score = calculate_match_score(make_lost_report(area_name=" 잠실 한강공원 "), make_found_item(area_name="잠실 한강공원"))

    assert score is not None
    assert score.area_score == 25


def test_time_score_boundaries() -> None:
    lost_at = utc_now()

    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at - timedelta(hours=12))).time_score == 20
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at - timedelta(hours=12, seconds=1))) is None
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=3))).time_score == 20
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=3, seconds=1))).time_score == 15
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=7))).time_score == 15
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=7, seconds=1))).time_score == 10
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=30))).time_score == 10
    assert calculate_match_score(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + timedelta(days=30, seconds=1))).time_score == 0


@pytest.mark.parametrize(("delta", "score", "too_early"), [
    (timedelta(hours=-12), 20, False),
    (-timedelta(hours=12, seconds=1), 0, True),
    (-timedelta(minutes=5), 20, False),
    (timedelta(0), 20, False),
])
def test_time_evaluation_early_boundaries(delta: timedelta, score: int, too_early: bool) -> None:
    lost_at = datetime(2026, 1, 1, tzinfo=UTC)
    evaluation = evaluate_time(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at + delta))

    assert evaluation.time_score == score
    assert evaluation.delta_hours == pytest.approx(delta.total_seconds() / 3600)
    assert evaluation.too_early is too_early


def test_time_evaluation_normalizes_timezone_aware_values_to_utc() -> None:
    lost_at_kst = datetime(2026, 1, 1, 15, tzinfo=timezone(timedelta(hours=9)))
    found_at_utc = datetime(2026, 1, 1, 6, tzinfo=UTC)

    evaluation = evaluate_time(make_lost_report(lost_from=lost_at_kst), make_found_item(found_at=found_at_utc))

    assert evaluation.delta_hours == 0
    assert evaluation.time_score == 20 and evaluation.too_early is False


def test_color_and_keyword_score() -> None:
    score = calculate_match_score(
        make_lost_report(color="검정", description="검정 백팩 노트북 파우치"),
        make_found_item(color=" 검정", public_description="검정 백팩 발견"),
    )

    assert score is not None
    assert score.keyword_score == 11


def test_single_color_candidate_keeps_existing_color_score() -> None:
    score = calculate_match_score(
        make_lost_report(color="검정", colors=["검정"], description="특징 없음"),
        make_found_item(color="검정", public_description="다른 설명"),
    )

    assert score is not None
    assert score.keyword_score == 10


def test_secondary_lost_report_color_receives_color_score() -> None:
    score = calculate_match_score(
        make_lost_report(color="검정", colors=["검정", "빨강"], description="특징 없음"),
        make_found_item(color=" 빨강 ", public_description="다른 설명"),
    )

    assert score is not None
    assert score.keyword_score == 10


def test_unmatched_lost_report_colors_receive_no_color_score() -> None:
    score = calculate_match_score(
        make_lost_report(color="검정", colors=["검정", "빨강"], description="특징 없음"),
        make_found_item(color="파랑", public_description="다른 설명"),
    )

    assert score is not None
    assert score.keyword_score == 0


def test_legacy_empty_colors_falls_back_to_single_color() -> None:
    score = calculate_match_score(
        make_lost_report(color="검정", colors=[], description="특징 없음"),
        make_found_item(color="검정", public_description="다른 설명"),
    )

    assert score is not None
    assert score.keyword_score == 10


def test_matching_multiple_color_candidates_does_not_duplicate_score() -> None:
    score = calculate_match_score(
        make_lost_report(color="검정", colors=["검정", " 검정 ", "빨강"], description="특징 없음"),
        make_found_item(color="검정", public_description="다른 설명"),
    )

    assert score is not None
    assert score.keyword_score == 10


def test_color_evaluation_matches_canonical_synonyms_and_exposes_normalized_values() -> None:
    evaluation = evaluate_color(
        make_lost_report(color="검정색", colors=["검정색", "빨강"]),
        make_found_item(color="블랙"),
    )

    assert isinstance(evaluation, ColorEvaluation)
    assert evaluation.lost_colors == frozenset({"검정", "빨강"})
    assert evaluation.found_color == "검정"
    assert evaluation.matched is True and evaluation.score == 10


def test_color_evaluation_supports_navy_and_multicolor_red_synonyms() -> None:
    navy = evaluate_color(make_lost_report(colors=["남색"]), make_found_item(color="navy"))
    red = evaluate_color(make_lost_report(colors=["검정", "빨강"]), make_found_item(color="빨간색"))

    assert navy.score == 10 and navy.found_color == "남색"
    assert red.score == 10 and red.found_color == "빨강"


@pytest.mark.parametrize(
    ("lost_color", "lost_colors", "found_color"),
    [(None, [], None), ("검정", [], None), (None, [], "검정"), ("여러 색", ["여러 색"], "여러 색"), ("검정", ["검정"], "빨강")],
)
def test_color_evaluation_gives_no_score_without_a_canonical_match(lost_color, lost_colors, found_color) -> None:
    evaluation = evaluate_color(make_lost_report(color=lost_color, colors=lost_colors), make_found_item(color=found_color))

    assert evaluation.matched is False and evaluation.score == 0


def test_feature_evaluation_removes_color_type_and_generic_words() -> None:
    evaluation = evaluate_features(
        make_lost_report(description="검정 가방을 분실했습니다 물건 신고"),
        make_found_item(public_description="블랙 가방 발견 물건 신고"),
    )

    assert isinstance(evaluation, FeatureEvaluation)
    assert evaluation.shared_features == frozenset()
    assert evaluation.score == 0


def test_feature_evaluation_canonicalizes_real_ui_synonyms_once() -> None:
    evaluation = evaluate_features(
        make_lost_report(description="앞주머니에 키링이 있고 오른쪽에 흠집이 있으며 지퍼와 줄무늬가 있어요"),
        make_found_item(public_description="열쇠고리가 달렸고 스크래치가 있으며 zipper와 스트라이프가 보여요"),
    )

    assert evaluation.shared_features == frozenset({"KEYRING", "SCRATCH", "ZIPPER", "STRIPE"})
    assert evaluation.score == 4


def test_feature_evaluation_different_features_do_not_match() -> None:
    evaluation = evaluate_features(make_lost_report(description="키링"), make_found_item(public_description="버클"))

    assert evaluation.shared_features == frozenset() and evaluation.score == 0


def test_feature_evaluation_is_safe_for_missing_or_empty_descriptions() -> None:
    missing = evaluate_features(make_lost_report(description="키링"), make_found_item(public_description=None))
    empty = evaluate_features(make_lost_report(description="   "), make_found_item(public_description=""))

    assert missing.found_features == frozenset() and missing.score == 0
    assert empty.lost_features == empty.found_features == frozenset() and empty.score == 0


def test_feature_score_is_capped_at_five() -> None:
    text = "로고 스티커 버클 쿠션 파우치 이니셜 장식"
    evaluation = evaluate_features(make_lost_report(description=text), make_found_item(public_description=text))

    assert len(evaluation.shared_features) == 7
    assert evaluation.score == 5


def test_color_is_not_double_counted_as_a_feature() -> None:
    lost_report = make_lost_report(color="검정", colors=["검정"], description="검정 가방을 분실했습니다")
    found_item = make_found_item(color="블랙", public_description="블랙 가방 발견")

    assert evaluate_color(lost_report, found_item).score == 10
    assert evaluate_features(lost_report, found_item).score == 0
    assert calculate_match_score(lost_report, found_item).keyword_score == 10


def test_threshold_value() -> None:
    assert MATCH_THRESHOLD == 60


def test_candidate_rank_key_uses_documented_deterministic_tie_break_order() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    candidates = [
        MatchCandidate(id=1, total_score=90, area_score=10, keyword_score=15, time_score=20, type_score=40, created_at=now, updated_at=now),
        MatchCandidate(id=2, total_score=90, area_score=25, keyword_score=5, time_score=10, type_score=40, created_at=now, updated_at=now),
        MatchCandidate(id=3, total_score=90, area_score=25, keyword_score=10, time_score=5, type_score=40, created_at=now, updated_at=now),
        MatchCandidate(id=4, total_score=90, area_score=25, keyword_score=10, time_score=20, type_score=40, created_at=now, updated_at=now),
        MatchCandidate(id=5, total_score=90, area_score=25, keyword_score=10, time_score=20, type_score=40, created_at=now + timedelta(seconds=1), updated_at=now),
        MatchCandidate(id=6, total_score=90, area_score=25, keyword_score=10, time_score=20, type_score=40, created_at=now + timedelta(seconds=1), updated_at=now),
    ]

    assert [candidate.id for candidate in sorted(candidates, key=candidate_rank_key, reverse=True)] == [6, 5, 4, 3, 2, 1]


def test_evaluation_rejects_type_mismatch() -> None:
    evaluation = evaluate_match_candidate(make_lost_report(object_class_id=11), make_found_item(object_class_id=12))

    assert evaluation.eligible is False
    assert evaluation.score is None
    assert evaluation.rejection_reason == MatchRejectionReason.TYPE_MISMATCH


def test_evaluation_rejects_time_more_than_twelve_hours_early() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(make_lost_report(lost_from=lost_at), make_found_item(found_at=lost_at - timedelta(hours=12, seconds=1)))

    assert evaluation.eligible is False
    assert evaluation.score is None
    assert evaluation.rejection_reason == MatchRejectionReason.TIME_TOO_EARLY


def test_time_too_early_takes_precedence_over_location_too_far() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, latitude=37.5665, longitude=126.9780),
        make_found_item(found_at=lost_at - timedelta(hours=13), latitude=35.1796, longitude=129.0756),
    )

    assert evaluation.rejection_reason == MatchRejectionReason.TIME_TOO_EARLY


def test_evaluation_rejects_type_and_time_only_as_insufficient_evidence() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, area_name="서울", color="검정", colors=["검정"], description="고유 특징 없음"),
        make_found_item(found_at=lost_at - timedelta(hours=1), area_name="부산", color="빨강", public_description="별도 설명"),
    )

    assert evaluation.eligible is False
    assert evaluation.score is not None
    assert evaluation.score.total_score == 60
    assert evaluation.score.area_score == 0 and evaluation.score.keyword_score == 0
    assert evaluation.rejection_reason == MatchRejectionReason.INSUFFICIENT_EVIDENCE


def test_early_tolerance_with_near_coordinates_is_eligible() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, latitude=37.52, longitude=127.10, color="검정", colors=["검정"]),
        make_found_item(found_at=lost_at - timedelta(hours=1), latitude=37.522, longitude=127.102, color="빨강", public_description="별도 설명"),
    )

    assert evaluation.eligible is True
    assert evaluation.score is not None and evaluation.score.total_score == 85


def test_more_than_thirty_days_can_match_with_strong_evidence() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, latitude=37.52, longitude=127.10, color="검정", colors=["검정"], description="희귀 표식 노트북 파우치 스티커"),
        make_found_item(found_at=lost_at + timedelta(days=40), latitude=37.522, longitude=127.102, color="검정", public_description="희귀 표식 노트북 파우치 스티커"),
    )

    assert evaluation.eligible is True
    assert evaluation.score is not None
    assert evaluation.score.time_score == 0 and evaluation.score.total_score == 80


def test_evaluation_accepts_area_evidence() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, area_name="서울", color="검정", colors=["검정"], description="특징 없음"),
        make_found_item(found_at=lost_at + timedelta(days=1), area_name="서울", color="빨강", public_description="별도 설명"),
    )

    assert evaluation.eligible is True
    assert evaluation.score is not None and evaluation.score.total_score == 85
    assert evaluation.rejection_reason is None


def test_evaluation_accepts_color_evidence() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, area_name="서울", color="검정", colors=["검정"], description="특징 없음"),
        make_found_item(found_at=lost_at + timedelta(days=1), area_name="부산", color="검정", public_description="별도 설명"),
    )

    assert evaluation.eligible is True
    assert evaluation.score is not None and evaluation.score.total_score == 70
    assert evaluation.rejection_reason is None


def test_evaluation_rejects_evidence_below_threshold() -> None:
    lost_at = utc_now()
    evaluation = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, area_name="서울", color="검정", colors=["검정"], description="희귀표식"),
        make_found_item(found_at=lost_at + timedelta(days=10), area_name="부산", color="빨강", public_description="희귀표식"),
    )

    assert evaluation.eligible is False
    assert evaluation.score is not None and evaluation.score.total_score == 51
    assert evaluation.rejection_reason == MatchRejectionReason.BELOW_THRESHOLD


def test_haversine_distance_is_zero_symmetric_and_realistic() -> None:
    assert calculate_distance_km(37.5665, 126.9780, 37.5665, 126.9780) == pytest.approx(0)
    seoul_to_busan = calculate_distance_km(37.5665, 126.9780, 35.1796, 129.0756)
    busan_to_seoul = calculate_distance_km(35.1796, 129.0756, 37.5665, 126.9780)

    assert 320 < seoul_to_busan < 330
    assert busan_to_seoul == pytest.approx(seoul_to_busan)


@pytest.mark.parametrize(
    ("distance", "score"),
    [(0, 25), (1, 25), (1.01, 15), (5, 15), (5.01, 5), (15, 5), (15.01, 0), (30, 0), (30.01, 0)],
)
def test_location_score_boundaries(distance: float, score: int) -> None:
    assert location_score_for_distance(distance) == score


def test_coordinates_override_different_area_names_when_near() -> None:
    location = evaluate_location(
        make_lost_report(area_name="잠실 한강공원", latitude=37.5200, longitude=127.1000),
        make_found_item(area_name="서울 송파구 잠실동", latitude=37.5220, longitude=127.1020),
    )

    assert location.source == LocationEvidenceSource.COORDINATES
    assert location.distance_km is not None and location.distance_km < 1
    assert location.area_score == 25 and location.too_far is False


def test_coordinates_override_same_area_name_when_too_far() -> None:
    lost_report = make_lost_report(area_name="한강공원", latitude=37.5665, longitude=126.9780)
    found_item = make_found_item(area_name="한강공원", latitude=35.1796, longitude=129.0756, color=lost_report.color)
    location = evaluate_location(lost_report, found_item)
    evaluation = evaluate_match_candidate(lost_report, found_item)

    assert location.source == LocationEvidenceSource.COORDINATES and location.too_far is True
    assert evaluation.eligible is False
    assert evaluation.score is None
    assert evaluation.rejection_reason == MatchRejectionReason.LOCATION_TOO_FAR


def test_partial_coordinates_fall_back_to_whitespace_normalized_area_name() -> None:
    location = evaluate_location(
        make_lost_report(area_name="잠실 한강공원", latitude=37.52, longitude=127.1),
        make_found_item(area_name="잠실한강공원", latitude=None, longitude=None),
    )

    assert location.source == LocationEvidenceSource.AREA_NAME
    assert location.distance_km is None and location.area_score == 25


def test_soft_distance_zone_uses_evidence_gate_instead_of_hard_rejection() -> None:
    lost_at = utc_now()
    without_evidence = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, latitude=37.0, longitude=127.0, area_name="서울", color="검정", colors=["검정"], description="특징 없음"),
        make_found_item(found_at=lost_at + timedelta(days=1), latitude=37.18, longitude=127.0, area_name="서울", color="빨강", public_description="별도 설명"),
    )
    with_color = evaluate_match_candidate(
        make_lost_report(lost_from=lost_at, latitude=37.0, longitude=127.0, area_name="서울", color="검정", colors=["검정"], description="특징 없음"),
        make_found_item(found_at=lost_at + timedelta(days=1), latitude=37.18, longitude=127.0, area_name="서울", color="검정", public_description="별도 설명"),
    )

    assert without_evidence.rejection_reason == MatchRejectionReason.INSUFFICIENT_EVIDENCE
    assert with_color.eligible is True and with_color.score is not None and with_color.score.area_score == 0
