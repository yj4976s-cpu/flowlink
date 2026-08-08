from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.security import to_utc, utc_now
from app.models import FoundItem, LostReport, MatchCandidate, Notification
from app.repositories.user_flow import (
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

    type_score = 40
    area_score = 25 if normalize_text(lost_report.area_name) == normalize_text(found_item.area_name) else 0

    lost_at = to_utc(lost_report.lost_from)
    found_at = to_utc(found_item.found_at)
    if found_at < lost_at:
        time_score = 0
    elif found_at <= lost_at + timedelta(days=7):
        time_score = 20
    elif found_at <= lost_at + timedelta(days=30):
        time_score = 10
    else:
        time_score = 0

    color_score = (
        10
        if clean_optional_text(lost_report.color) is not None
        and normalize_text(lost_report.color) == normalize_text(found_item.color)
        else 0
    )
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
        # 후보와 알림은 같은 transaction에서 저장한다. 후보만 있고 알림이 없는 반쪽 상태를 피하기 위함이다.
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
    return created
