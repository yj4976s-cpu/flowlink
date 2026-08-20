from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, timedelta
from enum import StrEnum
from math import asin, cos, radians, sin, sqrt

from sqlalchemy.orm import Session
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.core.security import to_utc, utc_now
from app.models import FoundItem, LostReport, MatchCandidate, Notification, OwnershipClaim
from app.services.color_estimation import normalize_item_color
from app.repositories.user_flow import (
    MATCHABLE_FOUND_ITEM_STATUSES,
    add_match_candidate,
    add_notification,
    clean_optional_text,
    list_matchable_found_items,
    match_candidate_exists,
)

MATCH_THRESHOLD = 60
EARTH_RADIUS_KM = 6371.0088
LOCATION_FULL_SCORE_KM = 1.0
LOCATION_MEDIUM_SCORE_KM = 5.0
LOCATION_LOW_SCORE_KM = 15.0
LOCATION_HARD_CUTOFF_KM = 30.0
EARLY_TIME_TOLERANCE_HOURS = 12
TIME_FULL_SCORE_DAYS = 3
TIME_MEDIUM_SCORE_DAYS = 7
TIME_LOW_SCORE_DAYS = 30
MAX_ACTIVE_MATCH_CANDIDATES_PER_REPORT = 5
GENERAL_ACTIVE_MATCH_STATUSES = frozenset({"SUGGESTED", "NOTIFIED", "VIEWED"})

FEATURE_STOPWORDS = frozenset({
    "물건", "분실", "분실했습니다", "발견", "발견했습니다", "신고", "찾음", "찾았음",
    "있음", "있어요", "있습니다", "있으며", "입니다", "같아요", "보임", "보여요", "특징", "없음",
})
ITEM_TYPE_TOKENS = frozenset({
    "가방", "가방을", "우산", "우산을", "신발", "신발을", "슬리퍼", "슬리퍼를",
    "bag", "umbrella", "footwear", "shoe", "ball",
})
FEATURE_CANONICAL_ALIASES = {
    "키링": "KEYRING", "키링이": "KEYRING", "열쇠고리": "KEYRING", "열쇠고리가": "KEYRING",
    "흠집": "SCRATCH", "흠집이": "SCRATCH", "스크래치": "SCRATCH", "스크래치가": "SCRATCH",
    "긁힘": "SCRATCH", "긁힌자국": "SCRATCH",
    "지퍼": "ZIPPER", "지퍼가": "ZIPPER", "지퍼와": "ZIPPER", "zipper": "ZIPPER", "zipper와": "ZIPPER",
    "줄무늬": "STRIPE", "줄무늬가": "STRIPE", "스트라이프": "STRIPE", "스트라이프가": "STRIPE", "stripe": "STRIPE",
    "손목끈": "WRIST_STRAP", "스트랩": "WRIST_STRAP", "손목스트랩": "WRIST_STRAP",
}


@dataclass(frozen=True)
class MatchScore:
    total_score: int
    type_score: int
    area_score: int
    time_score: int
    keyword_score: int


class MatchRejectionReason(StrEnum):
    TYPE_MISMATCH = "TYPE_MISMATCH"
    TIME_TOO_EARLY = "TIME_TOO_EARLY"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    BELOW_THRESHOLD = "BELOW_THRESHOLD"
    LOCATION_TOO_FAR = "LOCATION_TOO_FAR"


class LocationEvidenceSource(StrEnum):
    COORDINATES = "COORDINATES"
    AREA_NAME = "AREA_NAME"
    NONE = "NONE"


@dataclass(frozen=True)
class LocationEvaluation:
    area_score: int
    distance_km: float | None
    source: LocationEvidenceSource
    too_far: bool


@dataclass(frozen=True)
class TimeEvaluation:
    time_score: int
    delta_hours: float
    too_early: bool


@dataclass(frozen=True)
class ColorEvaluation:
    matched: bool
    score: int
    lost_colors: frozenset[str]
    found_color: str | None


@dataclass(frozen=True)
class FeatureEvaluation:
    lost_features: frozenset[str]
    found_features: frozenset[str]
    shared_features: frozenset[str]
    score: int


@dataclass(frozen=True)
class MatchEvaluation:
    eligible: bool
    score: MatchScore | None
    rejection_reason: MatchRejectionReason | None


def normalize_text(value: str | None) -> str:
    return (value or "").strip().casefold()


def meaningful_tokens(value: str | None) -> set[str]:
    return {token for token in re.findall(r"[0-9A-Za-z가-힣]+", normalize_text(value)) if len(token) >= 2}


def evaluate_color(lost_report: LostReport, found_item: FoundItem) -> ColorEvaluation:
    stored_colors = lost_report.colors or ([lost_report.color] if lost_report.color else [])
    lost_colors = frozenset(
        canonical
        for color in stored_colors
        if (canonical := normalize_item_color(clean_optional_text(color))) is not None
    )
    found_color = normalize_item_color(clean_optional_text(found_item.color))
    matched = found_color is not None and found_color in lost_colors
    return ColorEvaluation(matched=matched, score=10 if matched else 0, lost_colors=lost_colors, found_color=found_color)


def _normalized_features(value: str | None) -> frozenset[str]:
    features: set[str] = set()
    for token in meaningful_tokens(value):
        if token in FEATURE_STOPWORDS or token in ITEM_TYPE_TOKENS or normalize_item_color(token) is not None:
            continue
        features.add(FEATURE_CANONICAL_ALIASES.get(token, token))
    return frozenset(features)


def evaluate_features(lost_report: LostReport, found_item: FoundItem) -> FeatureEvaluation:
    lost_features = _normalized_features(lost_report.description)
    found_features = _normalized_features(found_item.public_description)
    shared_features = lost_features & found_features
    return FeatureEvaluation(
        lost_features=lost_features,
        found_features=found_features,
        shared_features=shared_features,
        score=min(5, len(shared_features)),
    )


def normalize_area_name(value: str | None) -> str:
    return "".join((value or "").split()).casefold()


def calculate_distance_km(lat1, lon1, lat2, lon2) -> float:
    latitude1, longitude1, latitude2, longitude2 = map(float, (lat1, lon1, lat2, lon2))
    if not -90 <= latitude1 <= 90 or not -90 <= latitude2 <= 90:
        raise ValueError("Latitude must be between -90 and 90")
    if not -180 <= longitude1 <= 180 or not -180 <= longitude2 <= 180:
        raise ValueError("Longitude must be between -180 and 180")
    lat_delta = radians(latitude2 - latitude1)
    lon_delta = radians(longitude2 - longitude1)
    a = sin(lat_delta / 2) ** 2 + cos(radians(latitude1)) * cos(radians(latitude2)) * sin(lon_delta / 2) ** 2
    return EARTH_RADIUS_KM * 2 * asin(sqrt(a))


def location_score_for_distance(distance_km: float) -> int:
    if distance_km <= LOCATION_FULL_SCORE_KM:
        return 25
    if distance_km <= LOCATION_MEDIUM_SCORE_KM:
        return 15
    if distance_km <= LOCATION_LOW_SCORE_KM:
        return 5
    return 0


def evaluate_location(lost_report: LostReport, found_item: FoundItem) -> LocationEvaluation:
    lost_coordinates = lost_report.latitude is not None and lost_report.longitude is not None
    found_coordinates = found_item.latitude is not None and found_item.longitude is not None
    if lost_coordinates and found_coordinates:
        distance = calculate_distance_km(
            lost_report.latitude,
            lost_report.longitude,
            found_item.latitude,
            found_item.longitude,
        )
        return LocationEvaluation(
            area_score=location_score_for_distance(distance),
            distance_km=distance,
            source=LocationEvidenceSource.COORDINATES,
            too_far=distance > LOCATION_HARD_CUTOFF_KM,
        )
    lost_area = normalize_area_name(lost_report.area_name)
    found_area = normalize_area_name(found_item.area_name)
    if lost_area and found_area:
        return LocationEvaluation(25 if lost_area == found_area else 0, None, LocationEvidenceSource.AREA_NAME, False)
    return LocationEvaluation(0, None, LocationEvidenceSource.NONE, False)


def evaluate_time(lost_report: LostReport, found_item: FoundItem) -> TimeEvaluation:
    delta = to_utc(found_item.found_at) - to_utc(lost_report.lost_from)
    delta_hours = delta.total_seconds() / 3600
    if delta < -timedelta(hours=EARLY_TIME_TOLERANCE_HOURS):
        return TimeEvaluation(time_score=0, delta_hours=delta_hours, too_early=True)
    if delta <= timedelta(days=TIME_FULL_SCORE_DAYS):
        time_score = 20
    elif delta <= timedelta(days=TIME_MEDIUM_SCORE_DAYS):
        time_score = 15
    elif delta <= timedelta(days=TIME_LOW_SCORE_DAYS):
        time_score = 10
    else:
        time_score = 0
    return TimeEvaluation(time_score=time_score, delta_hours=delta_hours, too_early=False)


def calculate_match_score(lost_report: LostReport, found_item: FoundItem) -> MatchScore | None:
    if lost_report.object_class_id != found_item.object_class_id:
        return None

    time = evaluate_time(lost_report, found_item)
    if time.too_early:
        return None

    type_score = 40
    area_score = evaluate_location(lost_report, found_item).area_score

    time_score = time.time_score

    color = evaluate_color(lost_report, found_item)
    features = evaluate_features(lost_report, found_item)
    keyword_score = color.score + features.score

    total_score = type_score + area_score + time_score + keyword_score
    return MatchScore(
        total_score=total_score,
        type_score=type_score,
        area_score=area_score,
        time_score=time_score,
        keyword_score=keyword_score,
    )


def evaluate_match_candidate(lost_report: LostReport, found_item: FoundItem) -> MatchEvaluation:
    if lost_report.object_class_id != found_item.object_class_id:
        return MatchEvaluation(False, None, MatchRejectionReason.TYPE_MISMATCH)
    time = evaluate_time(lost_report, found_item)
    if time.too_early:
        return MatchEvaluation(False, None, MatchRejectionReason.TIME_TOO_EARLY)
    location = evaluate_location(lost_report, found_item)
    if location.too_far:
        return MatchEvaluation(False, None, MatchRejectionReason.LOCATION_TOO_FAR)

    score = calculate_match_score(lost_report, found_item)
    if score is None:
        raise RuntimeError("Eligible match inputs must produce a score")
    if score.area_score == 0 and score.keyword_score == 0:
        return MatchEvaluation(False, score, MatchRejectionReason.INSUFFICIENT_EVIDENCE)
    if score.total_score < MATCH_THRESHOLD:
        return MatchEvaluation(False, score, MatchRejectionReason.BELOW_THRESHOLD)
    return MatchEvaluation(True, score, None)


def _apply_score(candidate: MatchCandidate, score: MatchScore, now) -> None:
    candidate.total_score = score.total_score
    candidate.type_score = score.type_score
    candidate.area_score = score.area_score
    candidate.time_score = score.time_score
    candidate.keyword_score = score.keyword_score
    candidate.updated_at = now


def candidate_rank_key(candidate: MatchCandidate) -> tuple[int, int, int, int, float, int]:
    created_at = candidate.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return (
        candidate.total_score,
        candidate.area_score,
        candidate.keyword_score,
        candidate.time_score,
        created_at.timestamp(),
        candidate.id or 0,
    )


def _add_grouped_match_notification(db: Session, lost_report: LostReport, new_entry_count: int, now) -> None:
    message = (
        "새로운 매칭 후보를 찾았어요."
        if new_entry_count == 1
        else f"새로운 매칭 후보 {new_entry_count}건을 찾았어요."
    )
    add_notification(
        db,
        Notification(
            user_id=lost_report.user_id,
            notification_type="MATCH_FOUND",
            title="매칭 후보가 발견되었습니다",
            message=message,
            related_type="LOST_REPORT",
            related_id=lost_report.id,
            created_at=now,
        ),
    )


def reconcile_top_match_candidates_for_report(db: Session, lost_report: LostReport) -> list[MatchCandidate]:
    """Keep at most five eligible general recommendations active for one report."""
    locked_report = db.scalar(select(LostReport).where(LostReport.id == lost_report.id).with_for_update())
    if locked_report is not None:
        lost_report = locked_report
    candidates = list(db.scalars(
        select(MatchCandidate)
        .options(joinedload(MatchCandidate.found_item))
        .where(MatchCandidate.lost_report_id == lost_report.id)
    ).all())
    before_ids = {candidate.id for candidate in candidates if candidate.status in GENERAL_ACTIVE_MATCH_STATUSES}
    rejected_found_item_ids = _rejected_found_item_ids_for_report(db, lost_report)
    eligible: list[MatchCandidate] = []
    now = utc_now()
    if lost_report.lost_from.tzinfo is None:
        lost_report.lost_from = lost_report.lost_from.replace(tzinfo=UTC)

    for candidate in candidates:
        if candidate.status == "CLAIMED":
            continue
        found_item = candidate.found_item
        if found_item.found_at.tzinfo is None:
            found_item.found_at = found_item.found_at.replace(tzinfo=UTC)
        evaluation = evaluate_match_candidate(lost_report, found_item)
        if evaluation.score is not None:
            _apply_score(candidate, evaluation.score, now)
        qualifies = (
            candidate.found_item_id not in rejected_found_item_ids
            and found_item.is_public
            and found_item.status in MATCHABLE_FOUND_ITEM_STATUSES
            and evaluation.eligible
        )
        if qualifies:
            eligible.append(candidate)
        else:
            candidate.status = "DISMISSED"

    ranked = sorted(eligible, key=candidate_rank_key, reverse=True)
    top_candidates = ranked[:MAX_ACTIVE_MATCH_CANDIDATES_PER_REPORT]
    top_ids = {candidate.id for candidate in top_candidates}
    for candidate in eligible:
        if candidate.id in top_ids:
            if candidate.status == "DISMISSED":
                candidate.status = "NOTIFIED"
        else:
            candidate.status = "DISMISSED"

    after_ids = {candidate.id for candidate in candidates if candidate.status in GENERAL_ACTIVE_MATCH_STATUSES}
    new_entry_count = len(after_ids - before_ids)
    if new_entry_count:
        _add_grouped_match_notification(db, lost_report, new_entry_count, now)

    has_claimed = any(candidate.status == "CLAIMED" for candidate in candidates)
    if after_ids or has_claimed:
        if lost_report.status == "OPEN":
            lost_report.status = "MATCHED"
            lost_report.updated_at = now
    elif lost_report.status == "MATCHED":
        lost_report.status = "OPEN"
        lost_report.updated_at = now
    return top_candidates


def _restore_reports_without_active_candidates(db: Session, reports: list[LostReport], now) -> None:
    db.flush()
    for lost_report in reports:
        if lost_report.status != "MATCHED":
            continue
        has_active_candidate = db.scalar(
            select(MatchCandidate.id).where(
                MatchCandidate.lost_report_id == lost_report.id,
                MatchCandidate.status != "DISMISSED",
            ).limit(1)
        )
        if has_active_candidate is None:
            lost_report.status = "OPEN"
            lost_report.updated_at = now


def _rejected_report_ids_for_found_item(db: Session, found_item_id: int) -> set[int]:
    return set(db.scalars(
        select(OwnershipClaim.lost_report_id)
        .join(LostReport, LostReport.id == OwnershipClaim.lost_report_id)
        .where(
            OwnershipClaim.found_item_id == found_item_id,
            OwnershipClaim.status == "REJECTED",
            OwnershipClaim.user_id == LostReport.user_id,
            OwnershipClaim.lost_report_id.is_not(None),
        )
    ).all())


def _rejected_found_item_ids_for_report(db: Session, lost_report: LostReport) -> set[int]:
    return set(db.scalars(
        select(OwnershipClaim.found_item_id).where(
            OwnershipClaim.user_id == lost_report.user_id,
            OwnershipClaim.lost_report_id == lost_report.id,
            OwnershipClaim.status == "REJECTED",
        )
    ).all())


def reconcile_match_candidates_for_found_item(db: Session, found_item: FoundItem) -> None:
    """Reconcile candidate membership and scores after found-item metadata changes."""
    existing = db.scalars(select(MatchCandidate).where(MatchCandidate.found_item_id == found_item.id)).all()
    if not found_item.is_public or found_item.status not in MATCHABLE_FOUND_ITEM_STATUSES:
        now = utc_now()
        for candidate in existing:
            if candidate.status != "CLAIMED":
                candidate.status = "DISMISSED"
                candidate.updated_at = now
        for lost_report in {candidate.lost_report for candidate in existing}:
            reconcile_top_match_candidates_for_report(db, lost_report)
        return
    candidates_by_report = {candidate.lost_report_id: candidate for candidate in existing}
    rejected_report_ids = _rejected_report_ids_for_found_item(db, found_item.id)
    reports = db.scalars(
        select(LostReport).where(
            LostReport.object_class_id == found_item.object_class_id,
            LostReport.status.in_(("OPEN", "MATCHED")),
        )
    ).all()
    reports_by_id = {report.id: report for report in reports}
    for candidate in existing:
        reports_by_id.setdefault(candidate.lost_report_id, candidate.lost_report)

    if found_item.found_at.tzinfo is None:
        found_item.found_at = found_item.found_at.replace(tzinfo=UTC)

    now = utc_now()
    for lost_report in reports_by_id.values():
        if lost_report.lost_from.tzinfo is None:
            lost_report.lost_from = lost_report.lost_from.replace(tzinfo=UTC)
        candidate = candidates_by_report.get(lost_report.id)
        evaluation = evaluate_match_candidate(lost_report, found_item)
        score = evaluation.score
        qualifies = (
            lost_report.id not in rejected_report_ids
            and evaluation.eligible
        )

        if qualifies:
            if score is None:
                raise RuntimeError("Eligible match evaluation must include a score")
            if candidate is None:
                candidate = MatchCandidate(
                    lost_report_id=lost_report.id,
                    found_item_id=found_item.id,
                    status="DISMISSED",
                    created_at=now,
                    updated_at=now,
                    total_score=score.total_score,
                    type_score=score.type_score,
                    area_score=score.area_score,
                    time_score=score.time_score,
                    keyword_score=score.keyword_score,
                )
                add_match_candidate(db, candidate)
                candidates_by_report[lost_report.id] = candidate
            else:
                _apply_score(candidate, score, now)
            continue

        if candidate is not None and score is not None:
            _apply_score(candidate, score, now)
        if candidate is not None and candidate.status != "CLAIMED":
            candidate.status = "DISMISSED"

    for lost_report in reports_by_id.values():
        reconcile_top_match_candidates_for_report(db, lost_report)


def create_match_candidates_for_lost_report(db: Session, lost_report: LostReport) -> list[MatchCandidate]:
    created: list[MatchCandidate] = []
    rejected_found_item_ids = _rejected_found_item_ids_for_report(db, lost_report)
    for found_item in list_matchable_found_items(db, lost_report.object_class_id):
        if found_item.id in rejected_found_item_ids:
            continue
        evaluation = evaluate_match_candidate(lost_report, found_item)
        if not evaluation.eligible:
            continue
        score = evaluation.score
        if score is None:
            raise RuntimeError("Eligible match evaluation must include a score")
        if match_candidate_exists(db, lost_report.id, found_item.id):
            continue

        now = utc_now()
        candidate = MatchCandidate(
            lost_report_id=lost_report.id,
            found_item_id=found_item.id,
            total_score=score.total_score,
            type_score=score.type_score,
            area_score=score.area_score,
            time_score=score.time_score,
            keyword_score=score.keyword_score,
            status="DISMISSED",
            created_at=now,
            updated_at=now,
        )
        add_match_candidate(db, candidate)
        created.append(candidate)

    reconcile_top_match_candidates_for_report(db, lost_report)

    return created


def create_match_candidates_for_found_item(db: Session, found_item: FoundItem) -> list[MatchCandidate]:
    created: list[MatchCandidate] = []
    rejected_report_ids = _rejected_report_ids_for_found_item(db, found_item.id)
    reports = db.scalars(
        select(LostReport).where(
            LostReport.object_class_id == found_item.object_class_id,
            LostReport.status.in_(("OPEN", "MATCHED")),
        )
    ).all()
    for lost_report in reports:
        if lost_report.id in rejected_report_ids:
            continue
        if lost_report.lost_from.tzinfo is None:
            lost_report.lost_from = lost_report.lost_from.replace(tzinfo=utc_now().tzinfo)
        evaluation = evaluate_match_candidate(lost_report, found_item)
        if not evaluation.eligible or match_candidate_exists(db, lost_report.id, found_item.id):
            continue
        score = evaluation.score
        if score is None:
            raise RuntimeError("Eligible match evaluation must include a score")
        now = utc_now()
        candidate = MatchCandidate(
            lost_report_id=lost_report.id, found_item_id=found_item.id,
            total_score=score.total_score, type_score=score.type_score,
            area_score=score.area_score, time_score=score.time_score,
            keyword_score=score.keyword_score, status="DISMISSED",
            created_at=now, updated_at=now,
        )
        add_match_candidate(db, candidate)
        created.append(candidate)
    for lost_report in reports:
        reconcile_top_match_candidates_for_report(db, lost_report)
    return created
