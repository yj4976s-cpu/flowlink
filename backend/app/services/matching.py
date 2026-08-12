from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, timedelta

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.security import to_utc, utc_now
from app.models import FoundItem, LostReport, MatchCandidate, Notification
from app.repositories.user_flow import (
    MATCHABLE_FOUND_ITEM_STATUSES,
    add_match_candidate,
    add_notification,
    clean_optional_text,
    list_matchable_found_items,
    match_candidate_exists,
)

MATCH_THRESHOLD = 60


@dataclass(frozen=True)
class MatchScore:
    total_score: int
    type_score: int
    area_score: int
    time_score: int
    keyword_score: int


def normalize_text(value: str | None) -> str:
    return (value or "").strip().casefold()


def meaningful_tokens(value: str | None) -> set[str]:
    return {token for token in re.findall(r"[0-9A-Za-z가-힣]+", normalize_text(value)) if len(token) >= 2}


def calculate_match_score(lost_report: LostReport, found_item: FoundItem) -> MatchScore | None:
    if lost_report.object_class_id != found_item.object_class_id:
        return None

    lost_at = to_utc(lost_report.lost_from)
    found_at = to_utc(found_item.found_at)
    if found_at < lost_at:
        return None

    type_score = 40
    area_score = 25 if normalize_text(lost_report.area_name) == normalize_text(found_item.area_name) else 0

    if found_at <= lost_at + timedelta(days=7):
        time_score = 20
    elif found_at <= lost_at + timedelta(days=30):
        time_score = 10
    else:
        time_score = 0

    stored_colors = lost_report.colors or ([lost_report.color] if lost_report.color else [])
    color_candidates = {
        normalize_text(color)
        for color in stored_colors
        if clean_optional_text(color) is not None and normalize_text(color) != normalize_text("여러 색")
    }
    found_color = normalize_text(found_item.color)
    color_score = 10 if found_color and found_color in color_candidates else 0
    shared_tokens = meaningful_tokens(lost_report.description) & meaningful_tokens(found_item.public_description)
    keyword_score = min(15, color_score + min(5, len(shared_tokens)))

    total_score = type_score + area_score + time_score + keyword_score
    return MatchScore(
        total_score=total_score,
        type_score=type_score,
        area_score=area_score,
        time_score=time_score,
        keyword_score=keyword_score,
    )


def _apply_score(candidate: MatchCandidate, score: MatchScore, now) -> None:
    candidate.total_score = score.total_score
    candidate.type_score = score.type_score
    candidate.area_score = score.area_score
    candidate.time_score = score.time_score
    candidate.keyword_score = score.keyword_score
    candidate.updated_at = now


def _ensure_match_notification(db: Session, candidate: MatchCandidate, lost_report: LostReport, now) -> None:
    exists = db.scalar(
        select(Notification.id).where(
            Notification.notification_type == "MATCH_FOUND",
            Notification.related_type == "MATCH_CANDIDATE",
            Notification.related_id == candidate.id,
        )
    )
    if exists is not None:
        return
    add_notification(
        db,
        Notification(
            user_id=lost_report.user_id,
            notification_type="MATCH_FOUND",
            title="매칭 후보가 발견되었습니다",
            message="등록한 분실 신고와 유사한 발견물이 있습니다.",
            related_type="MATCH_CANDIDATE",
            related_id=candidate.id,
            created_at=now,
        ),
    )


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


def reconcile_match_candidates_for_found_item(db: Session, found_item: FoundItem) -> None:
    """Reconcile candidate membership and scores after found-item metadata changes."""
    existing = db.scalars(select(MatchCandidate).where(MatchCandidate.found_item_id == found_item.id)).all()
    if not found_item.is_public or found_item.status not in MATCHABLE_FOUND_ITEM_STATUSES:
        now = utc_now()
        for candidate in existing:
            if candidate.status != "CLAIMED":
                candidate.status = "DISMISSED"
                candidate.updated_at = now
        _restore_reports_without_active_candidates(db, [candidate.lost_report for candidate in existing], now)
        return
    candidates_by_report = {candidate.lost_report_id: candidate for candidate in existing}
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
        score = calculate_match_score(lost_report, found_item)
        qualifies = score is not None and score.total_score >= MATCH_THRESHOLD

        if qualifies:
            if candidate is None:
                candidate = MatchCandidate(
                    lost_report_id=lost_report.id,
                    found_item_id=found_item.id,
                    status="NOTIFIED",
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
                if candidate.status == "DISMISSED":
                    candidate.status = "NOTIFIED"
            _ensure_match_notification(db, candidate, lost_report, now)
            if lost_report.status == "OPEN":
                lost_report.status = "MATCHED"
                lost_report.updated_at = now
            continue

        if candidate is not None and score is not None:
            _apply_score(candidate, score, now)
        if candidate is not None and candidate.status != "CLAIMED":
            candidate.status = "DISMISSED"

    _restore_reports_without_active_candidates(db, list(reports_by_id.values()), now)


def create_match_candidates_for_lost_report(db: Session, lost_report: LostReport) -> list[MatchCandidate]:
    created: list[MatchCandidate] = []
    for found_item in list_matchable_found_items(db, lost_report.object_class_id):
        score = calculate_match_score(lost_report, found_item)
        if score is None or score.total_score < MATCH_THRESHOLD:
            continue
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
            status="NOTIFIED",
            created_at=now,
            updated_at=now,
        )
        add_match_candidate(db, candidate)
        # 후보와 알림은 같은 transaction에 있어야 사용자가 후보 없는 알림을 받는 반쪽 상태를 피할 수 있다.
        add_notification(
            db,
            Notification(
                user_id=lost_report.user_id,
                notification_type="MATCH_FOUND",
                title="매칭 후보가 발견되었습니다",
                message="등록한 분실 신고와 유사한 발견물이 있습니다.",
                related_type="MATCH_CANDIDATE",
                related_id=candidate.id,
                created_at=now,
            ),
        )
        created.append(candidate)

    if created:
        now = utc_now()
        lost_report.status = "MATCHED"
        lost_report.updated_at = now

    return created


def create_match_candidates_for_found_item(db: Session, found_item: FoundItem) -> list[MatchCandidate]:
    created: list[MatchCandidate] = []
    reports = db.scalars(
        select(LostReport).where(
            LostReport.object_class_id == found_item.object_class_id,
            LostReport.status.in_(("OPEN", "MATCHED")),
        )
    ).all()
    for lost_report in reports:
        if lost_report.lost_from.tzinfo is None:
            lost_report.lost_from = lost_report.lost_from.replace(tzinfo=utc_now().tzinfo)
        score = calculate_match_score(lost_report, found_item)
        if score is None or score.total_score < MATCH_THRESHOLD or match_candidate_exists(db, lost_report.id, found_item.id):
            continue
        now = utc_now()
        candidate = MatchCandidate(
            lost_report_id=lost_report.id, found_item_id=found_item.id,
            total_score=score.total_score, type_score=score.type_score,
            area_score=score.area_score, time_score=score.time_score,
            keyword_score=score.keyword_score, status="NOTIFIED",
            created_at=now, updated_at=now,
        )
        add_match_candidate(db, candidate)
        db.flush()
        add_notification(db, Notification(
            user_id=lost_report.user_id, notification_type="MATCH_FOUND",
            title="매칭 후보가 발견되었습니다",
            message="등록한 분실 신고와 유사한 발견물이 있습니다.",
            related_type="MATCH_CANDIDATE", related_id=candidate.id, created_at=now,
        ))
        lost_report.status = "MATCHED"
        lost_report.updated_at = now
        created.append(candidate)
    return created
