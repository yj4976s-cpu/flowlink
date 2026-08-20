from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import app.services.matching as matching_service
import app.services.ownership as ownership_service
from app.core.security import utc_now
from app.db.session import Base
from app.models import FoundItem, LostReport, MatchCandidate, Notification, ObjectClass, OwnershipClaim, ProcessingHistory, User
from app.repositories.user_flow import list_matchable_found_items
from app.schemas.lost_report import LostReportCreateRequest
from app.schemas.ownership_claim import OwnershipClaimCreateRequest, OwnershipClaimUpdateRequest
from app.services.matching import create_match_candidates_for_found_item, create_match_candidates_for_lost_report, reconcile_match_candidates_for_found_item
from app.services.ownership import create_claim_for_user, review_ownership_claim


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, class_=Session)
    with SessionLocal() as session:
        yield session


@pytest.fixture(autouse=True)
def patch_bigint_identity_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    counters = {
        "claim": 1000,
        "history": 2000,
        "notification": 3000,
        "candidate": 4000,
    }

    def next_id(name: str) -> int:
        counters[name] += 1
        return counters[name]

    def add_claim(session: Session, claim: OwnershipClaim) -> OwnershipClaim:
        claim.id = next_id("claim")
        session.add(claim)
        session.flush()
        return claim

    def add_history(session: Session, history: ProcessingHistory) -> ProcessingHistory:
        history.id = next_id("history")
        session.add(history)
        session.flush()
        return history

    def add_notification(session: Session, notification: Notification) -> Notification:
        notification.id = next_id("notification")
        session.add(notification)
        session.flush()
        return notification

    def add_candidate(session: Session, candidate: MatchCandidate) -> MatchCandidate:
        candidate.id = next_id("candidate")
        session.add(candidate)
        session.flush()
        return candidate

    monkeypatch.setattr(ownership_service, "add_ownership_claim", add_claim)
    monkeypatch.setattr(ownership_service, "add_processing_history", add_history)
    monkeypatch.setattr(ownership_service, "add_notification", add_notification)
    monkeypatch.setattr(matching_service, "add_match_candidate", add_candidate)
    monkeypatch.setattr(matching_service, "add_notification", add_notification)


def seed_user(session: Session, user_id: int, *, role: str = "USER") -> User:
    now = utc_now()
    user = User(
        id=user_id,
        email=f"user{user_id}@example.com",
        password_hash="not-used",
        nickname=f"user{user_id}",
        role=role,
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    return user


def seed_object_class(session: Session, class_id: int, code: str) -> ObjectClass:
    now = utc_now()
    object_class = ObjectClass(
        id=class_id,
        code=code,
        name_ko=code,
        group_code="PERSONAL_ITEM",
        display_order=class_id,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add(object_class)
    return object_class


def seed_found_item(
    session: Session,
    item_id: int,
    *,
    object_class_id: int = 1,
    status: str = "AVAILABLE",
    is_public: bool = True,
    found_at: datetime | None = None,
) -> FoundItem:
    now = utc_now()
    item = FoundItem(
        id=item_id,
        object_class_id=object_class_id,
        source_type="ADMIN",
        color="검정",
        public_description="검정 백팩 발견",
        area_name="잠실 한강공원",
        found_at=found_at or now + timedelta(days=1),
        status=status,
        is_public=is_public,
        created_at=now,
        updated_at=now,
    )
    session.add(item)
    return item


def seed_lost_report(
    session: Session,
    report_id: int,
    *,
    user_id: int = 1,
    object_class_id: int = 1,
    status: str = "OPEN",
    lost_from: datetime | None = None,
) -> LostReport:
    now = utc_now()
    report = LostReport(
        id=report_id,
        user_id=user_id,
        object_class_id=object_class_id,
        color="검정",
        description="검정 백팩 노트북 파우치",
        area_name="잠실 한강공원",
        lost_from=lost_from or now,
        status=status,
        created_at=now,
        updated_at=now,
    )
    session.add(report)
    return report


def seed_claim(
    session: Session,
    claim_id: int,
    *,
    user_id: int = 1,
    found_item_id: int = 10,
    lost_report_id: int | None = 20,
    status: str = "PENDING",
) -> OwnershipClaim:
    now = utc_now()
    claim = OwnershipClaim(
        id=claim_id,
        user_id=user_id,
        found_item_id=found_item_id,
        lost_report_id=lost_report_id,
        verification_details="상세한 소유권 확인 정보입니다.",
        status=status,
        created_at=now,
        updated_at=now,
    )
    session.add(claim)
    return claim


def seed_basic_claim_data(db: Session) -> tuple[User, User]:
    user = seed_user(db, 1)
    admin = seed_user(db, 99, role="ADMIN")
    seed_object_class(db, 1, "BAG")
    seed_object_class(db, 2, "UMBRELLA")
    db.commit()
    return user, admin


@pytest.mark.parametrize(
    ("is_public", "item_status"),
    [
        (False, "AVAILABLE"),
        (True, "CLAIM_PENDING"),
        (True, "RETURNED"),
    ],
)
def test_private_or_non_available_found_item_claim_is_hidden(db: Session, is_public: bool, item_status: str) -> None:
    user, _ = seed_basic_claim_data(db)
    seed_found_item(db, 10, is_public=is_public, status=item_status)
    db.commit()

    request = OwnershipClaimCreateRequest(found_item_id=10, verification_details="충분히 자세한 확인 설명입니다.")
    with pytest.raises(HTTPException) as exc_info:
        create_claim_for_user(db, current_user=user, request=request)

    assert exc_info.value.status_code == 404


def test_other_users_lost_report_cannot_be_linked_to_claim(db: Session) -> None:
    user, _ = seed_basic_claim_data(db)
    seed_user(db, 2)
    seed_found_item(db, 10)
    seed_lost_report(db, 20, user_id=2)
    db.commit()

    request = OwnershipClaimCreateRequest(
        found_item_id=10,
        lost_report_id=20,
        verification_details="충분히 자세한 확인 설명입니다.",
    )
    with pytest.raises(HTTPException) as exc_info:
        create_claim_for_user(db, current_user=user, request=request)

    assert exc_info.value.status_code == 404


def test_lost_report_with_different_object_class_cannot_be_linked_to_claim(db: Session) -> None:
    user, _ = seed_basic_claim_data(db)
    seed_found_item(db, 10, object_class_id=1)
    seed_lost_report(db, 20, user_id=1, object_class_id=2)
    db.commit()

    request = OwnershipClaimCreateRequest(
        found_item_id=10,
        lost_report_id=20,
        verification_details="충분히 자세한 확인 설명입니다.",
    )
    with pytest.raises(HTTPException) as exc_info:
        create_claim_for_user(db, current_user=user, request=request)

    assert exc_info.value.status_code == 409


@pytest.mark.parametrize("report_status", ["CANCELLED", "RESOLVED"])
def test_terminal_lost_report_cannot_be_revived_by_claim(db: Session, report_status: str) -> None:
    user, _ = seed_basic_claim_data(db)
    found_item = seed_found_item(db, 10)
    lost_report = seed_lost_report(db, 20, status=report_status)
    db.commit()

    request = OwnershipClaimCreateRequest(
        found_item_id=10,
        lost_report_id=20,
        verification_details="충분히 자세한 확인 설명입니다.",
    )
    with pytest.raises(HTTPException) as exc_info:
        create_claim_for_user(db, current_user=user, request=request)

    assert exc_info.value.status_code == 409
    assert found_item.status == "AVAILABLE"
    assert lost_report.status == report_status


def test_pending_approved_returned_transition_is_allowed(db: Session) -> None:
    _, admin = seed_basic_claim_data(db)
    seed_found_item(db, 10, status="CLAIM_PENDING")
    seed_lost_report(db, 20, status="CLAIM_PENDING")
    seed_claim(db, 30, status="PENDING")
    db.commit()

    approved = review_ownership_claim(
        db,
        current_admin=admin,
        claim_id=30,
        request=OwnershipClaimUpdateRequest(status="APPROVED"),
    )
    returned = review_ownership_claim(
        db,
        current_admin=admin,
        claim_id=30,
        request=OwnershipClaimUpdateRequest(status="RETURNED"),
    )

    assert approved.status == "APPROVED"
    assert returned.status == "RETURNED"
    assert db.get(FoundItem, 10).status == "RETURNED"
    assert db.get(LostReport, 20).status == "RESOLVED"


def test_returned_claim_cannot_be_rejected(db: Session) -> None:
    _, admin = seed_basic_claim_data(db)
    seed_found_item(db, 10, status="RETURNED")
    seed_lost_report(db, 20, status="RESOLVED")
    seed_claim(db, 30, status="RETURNED")
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        review_ownership_claim(
            db,
            current_admin=admin,
            claim_id=30,
            request=OwnershipClaimUpdateRequest(status="REJECTED"),
        )

    assert exc_info.value.status_code == 409


def test_rejected_claim_does_not_make_found_item_available_when_another_active_claim_exists(db: Session) -> None:
    _, admin = seed_basic_claim_data(db)
    seed_user(db, 2)
    seed_found_item(db, 10, status="CLAIM_PENDING")
    seed_lost_report(db, 20, user_id=1, status="CLAIM_PENDING")
    seed_lost_report(db, 21, user_id=2, status="CLAIM_PENDING")
    seed_claim(db, 30, user_id=1, lost_report_id=20, status="PENDING")
    seed_claim(db, 31, user_id=2, lost_report_id=21, status="APPROVED")
    db.commit()

    review_ownership_claim(
        db,
        current_admin=admin,
        claim_id=30,
        request=OwnershipClaimUpdateRequest(status="REJECTED"),
    )

    assert db.get(FoundItem, 10).status == "CLAIM_PENDING"


def test_rejected_claim_reconciles_stale_candidate_below_threshold(db: Session) -> None:
    _, admin = seed_basic_claim_data(db)
    now = utc_now()
    found_item = seed_found_item(db, 10, status="CLAIM_PENDING", found_at=now)
    found_item.color = "red"
    found_item.area_name = "found-area"
    lost_report = seed_lost_report(db, 20, status="CLAIM_PENDING", lost_from=now - timedelta(days=10))
    lost_report.color = "blue"
    lost_report.colors = ["blue"]
    lost_report.description = "plain"
    lost_report.area_name = "lost-area"
    candidate = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=95, type_score=40, area_score=25, time_score=20, keyword_score=10, status="CLAIMED", created_at=now, updated_at=now)
    claim = seed_claim(db, 30, status="PENDING")
    db.add_all([candidate, Notification(id=60, user_id=1, notification_type="MATCH_FOUND", title="match", message="match", related_type="MATCH_CANDIDATE", related_id=50, created_at=now)])
    db.commit()

    review_ownership_claim(db, current_admin=admin, claim_id=30, request=OwnershipClaimUpdateRequest(status="REJECTED"))

    assert claim.status == "REJECTED"
    assert found_item.status == "AVAILABLE"
    assert candidate.status == "DISMISSED"
    assert candidate.total_score == 50
    assert lost_report.status == "OPEN"
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_id=50).count() == 1


def test_rejected_claim_keeps_claimant_candidate_dismissed_even_when_score_is_valid(db: Session) -> None:
    _, admin = seed_basic_claim_data(db)
    now = utc_now()
    found_item = seed_found_item(db, 10, status="CLAIM_PENDING", found_at=now)
    found_item.color = "red"
    found_item.area_name = "found-area"
    lost_report = seed_lost_report(db, 20, status="CLAIM_PENDING", lost_from=now - timedelta(days=1))
    lost_report.color = "red"
    lost_report.colors = ["red"]
    lost_report.description = "plain"
    lost_report.area_name = "lost-area"
    candidate = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=95, type_score=40, area_score=25, time_score=20, keyword_score=10, status="CLAIMED", created_at=now, updated_at=now)
    claim = seed_claim(db, 30, status="PENDING")
    db.add_all([candidate, Notification(id=60, user_id=1, notification_type="MATCH_FOUND", title="match", message="match", related_type="MATCH_CANDIDATE", related_id=50, created_at=now)])
    db.commit()

    review_ownership_claim(db, current_admin=admin, claim_id=30, request=OwnershipClaimUpdateRequest(status="REJECTED"))

    assert claim.status == "REJECTED"
    assert found_item.status == "AVAILABLE"
    assert candidate.status == "DISMISSED"
    assert candidate.total_score == 70
    assert (candidate.type_score, candidate.area_score, candidate.time_score, candidate.keyword_score) == (40, 0, 20, 10)
    assert lost_report.status == "OPEN"
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_id=50).count() == 1


def test_match_creation_marks_lost_report_matched(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    lost_report = seed_lost_report(db, 20, status="OPEN")
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=lost_report.lost_from + timedelta(days=1))
    db.flush()
    found_item.found_at = lost_report.lost_from + timedelta(days=1)
    monkeypatch.setattr(matching_service, "list_matchable_found_items", lambda session, object_class_id: [found_item])

    candidates = create_match_candidates_for_lost_report(db, lost_report)

    assert len(candidates) == 1
    assert lost_report.status == "MATCHED"


def test_ownership_claim_marks_related_match_claimed(db: Session) -> None:
    user, _ = seed_basic_claim_data(db)
    seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    seed_lost_report(db, 20, status="MATCHED")
    match = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=utc_now(), updated_at=utc_now())
    db.add(match)
    db.commit()

    create_claim_for_user(db, current_user=user, request=OwnershipClaimCreateRequest(found_item_id=10, lost_report_id=20, verification_details="안쪽 라벨 위치와 스티커를 자세히 설명합니다."))

    assert db.get(MatchCandidate, 50).status == "CLAIMED"


def test_ownership_claim_requests_found_item_row_lock(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    user, _ = seed_basic_claim_data(db)
    seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    db.commit()
    original = ownership_service.get_claimable_found_item_by_id
    lock_requested = False

    def get_locked_found_item(session: Session, found_item_id: int, *, for_update: bool = False):
        nonlocal lock_requested
        lock_requested = for_update
        return original(session, found_item_id, for_update=for_update)

    monkeypatch.setattr(ownership_service, "get_claimable_found_item_by_id", get_locked_found_item)

    create_claim_for_user(db, current_user=user, request=OwnershipClaimCreateRequest(found_item_id=10, verification_details="안쪽 라벨과 고유 스티커 위치를 자세히 설명합니다."))

    assert lock_requested is True


def test_claim_reconciles_all_other_candidate_states_and_report_statuses(db: Session) -> None:
    user, _ = seed_basic_claim_data(db)
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    seed_lost_report(db, 20, user_id=1, status="MATCHED")
    candidates = [
        MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=utc_now(), updated_at=utc_now()),
    ]
    for index, candidate_status in enumerate(("SUGGESTED", "NOTIFIED", "VIEWED"), start=2):
        seed_user(db, index)
        seed_lost_report(db, 20 + index, user_id=index, status="MATCHED")
        candidates.append(MatchCandidate(id=50 + index, lost_report_id=20 + index, found_item_id=10, total_score=80, type_score=40, area_score=25, time_score=15, keyword_score=0, status=candidate_status, created_at=utc_now(), updated_at=utc_now()))
    db.add_all(candidates)
    db.commit()

    result = create_claim_for_user(
        db,
        current_user=user,
        request=OwnershipClaimCreateRequest(found_item_id=10, lost_report_id=20, verification_details="안쪽 라벨과 고유 스티커 위치를 자세히 설명합니다."),
    )

    assert result.status == "PENDING"
    assert found_item.status == "CLAIM_PENDING"
    assert db.get(LostReport, 20).status == "CLAIM_PENDING"
    assert candidates[0].status == "CLAIMED"
    assert [candidate.status for candidate in candidates[1:]] == ["DISMISSED"] * 3
    assert [db.get(LostReport, report_id).status for report_id in (22, 23, 24)] == ["OPEN"] * 3


def test_claim_keeps_other_report_matched_when_another_active_candidate_remains(db: Session) -> None:
    user, _ = seed_basic_claim_data(db)
    seed_user(db, 2)
    seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    seed_found_item(db, 11, status="AVAILABLE", is_public=True)
    seed_lost_report(db, 20, user_id=1, status="MATCHED")
    other_report = seed_lost_report(db, 21, user_id=2, status="MATCHED")
    db.add_all([
        MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=utc_now(), updated_at=utc_now()),
        MatchCandidate(id=51, lost_report_id=21, found_item_id=10, total_score=80, type_score=40, area_score=25, time_score=15, keyword_score=0, status="VIEWED", created_at=utc_now(), updated_at=utc_now()),
        MatchCandidate(id=52, lost_report_id=21, found_item_id=11, total_score=75, type_score=40, area_score=25, time_score=10, keyword_score=0, status="NOTIFIED", created_at=utc_now(), updated_at=utc_now()),
    ])
    db.commit()

    create_claim_for_user(db, current_user=user, request=OwnershipClaimCreateRequest(found_item_id=10, lost_report_id=20, verification_details="안쪽 라벨과 고유 스티커 위치를 자세히 설명합니다."))

    assert db.get(MatchCandidate, 51).status == "DISMISSED"
    assert db.get(MatchCandidate, 52).status == "NOTIFIED"
    assert other_report.status == "MATCHED"


def test_rejected_claim_restores_existing_candidates_without_duplicates(db: Session) -> None:
    user, admin = seed_basic_claim_data(db)
    seed_user(db, 2)
    now = utc_now()
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now)
    report_a = seed_lost_report(db, 20, user_id=1, status="MATCHED", lost_from=now - timedelta(days=1))
    report_b = seed_lost_report(db, 21, user_id=2, status="MATCHED", lost_from=now - timedelta(days=1))
    candidates = [
        MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now),
        MatchCandidate(id=51, lost_report_id=21, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now),
    ]
    db.add_all(candidates + [
        Notification(id=60, user_id=1, notification_type="MATCH_FOUND", title="match", message="match", related_type="MATCH_CANDIDATE", related_id=50, created_at=now),
        Notification(id=61, user_id=2, notification_type="MATCH_FOUND", title="match", message="match", related_type="MATCH_CANDIDATE", related_id=51, created_at=now),
    ])
    db.commit()

    claim = create_claim_for_user(db, current_user=user, request=OwnershipClaimCreateRequest(found_item_id=10, lost_report_id=20, verification_details="안쪽 라벨과 고유 스티커 위치를 자세히 설명합니다."))
    assert candidates[1].status == "DISMISSED"
    review_ownership_claim(db, current_admin=admin, claim_id=claim.id, request=OwnershipClaimUpdateRequest(status="REJECTED"))

    assert found_item.status == "AVAILABLE"
    assert [candidate.status for candidate in candidates] == ["DISMISSED", "NOTIFIED"]
    assert [report_a.status, report_b.status] == ["OPEN", "MATCHED"]
    assert db.query(MatchCandidate).filter_by(found_item_id=10).count() == 2
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND").count() == 3
    grouped = db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_type="LOST_REPORT", related_id=report_b.id).one()
    assert grouped.message == "새로운 매칭 후보를 찾았어요."


def test_rejected_pair_does_not_block_other_candidate_or_new_claim(db: Session) -> None:
    user, _ = seed_basic_claim_data(db)
    now = utc_now()
    seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now)
    seed_found_item(db, 11, status="AVAILABLE", is_public=True, found_at=now)
    report = seed_lost_report(db, 20, status="MATCHED", lost_from=now - timedelta(days=1))
    rejected = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="DISMISSED", created_at=now, updated_at=now)
    available = MatchCandidate(id=51, lost_report_id=20, found_item_id=11, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now)
    db.add_all([rejected, available, seed_claim(db, 30, found_item_id=10, status="REJECTED")])
    db.commit()

    reconcile_match_candidates_for_found_item(db, db.get(FoundItem, 10))
    assert rejected.status == "DISMISSED"
    assert available.status == "NOTIFIED" and report.status == "MATCHED"
    result = create_claim_for_user(db, current_user=user, request=OwnershipClaimCreateRequest(found_item_id=11, lost_report_id=20, verification_details="다른 발견물의 고유 특징을 자세히 설명합니다."))

    assert result.status == "PENDING"
    assert available.status == "CLAIMED"


def test_same_rejected_pair_claim_still_returns_conflict(db: Session) -> None:
    user, _ = seed_basic_claim_data(db)
    seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    seed_lost_report(db, 20, status="OPEN")
    seed_claim(db, 30, status="REJECTED")
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        create_claim_for_user(db, current_user=user, request=OwnershipClaimCreateRequest(found_item_id=10, lost_report_id=20, verification_details="동일 조합을 다시 요청합니다."))

    assert exc_info.value.status_code == 409


def test_candidate_creation_paths_skip_rejected_pair(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_user(db, 2)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report_a = seed_lost_report(db, 20, user_id=1, status="OPEN", lost_from=now - timedelta(days=1))
    report_b = seed_lost_report(db, 21, user_id=2, status="OPEN", lost_from=now - timedelta(days=1))
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now)
    seed_claim(db, 30, user_id=1, found_item_id=10, lost_report_id=20, status="REJECTED")
    db.commit()
    found_item.found_at = now
    monkeypatch.setattr(matching_service, "list_matchable_found_items", lambda session, object_class_id: [found_item])

    assert create_match_candidates_for_lost_report(db, report_a) == []
    created = create_match_candidates_for_found_item(db, found_item)

    assert [(candidate.lost_report_id, candidate.found_item_id) for candidate in created] == [(21, 10)]
    assert db.query(MatchCandidate).filter_by(lost_report_id=20, found_item_id=10).count() == 0
    assert report_a.status == "OPEN" and report_b.status == "MATCHED"


def test_approved_and_returned_do_not_restore_other_candidates(db: Session) -> None:
    user, admin = seed_basic_claim_data(db)
    seed_user(db, 2)
    seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    seed_lost_report(db, 20, user_id=1, status="MATCHED")
    seed_lost_report(db, 21, user_id=2, status="MATCHED")
    db.add_all([
        MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=utc_now(), updated_at=utc_now()),
        MatchCandidate(id=51, lost_report_id=21, found_item_id=10, total_score=80, type_score=40, area_score=25, time_score=15, keyword_score=0, status="NOTIFIED", created_at=utc_now(), updated_at=utc_now()),
    ])
    db.commit()

    claim = create_claim_for_user(db, current_user=user, request=OwnershipClaimCreateRequest(found_item_id=10, lost_report_id=20, verification_details="안쪽 라벨과 고유 스티커 위치를 자세히 설명합니다."))
    review_ownership_claim(db, current_admin=admin, claim_id=claim.id, request=OwnershipClaimUpdateRequest(status="APPROVED"))
    assert db.get(FoundItem, 10).status == "CLAIM_PENDING"
    assert db.get(MatchCandidate, 51).status == "DISMISSED"
    review_ownership_claim(db, current_admin=admin, claim_id=claim.id, request=OwnershipClaimUpdateRequest(status="RETURNED"))
    assert db.get(FoundItem, 10).status == "RETURNED"
    assert db.get(MatchCandidate, 51).status == "DISMISSED"


def test_found_item_more_than_twelve_hours_before_lost_is_excluded_from_matching(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    lost_report = seed_lost_report(db, 20, status="OPEN")
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=lost_report.lost_from - timedelta(hours=13))
    db.flush()
    found_item.found_at = lost_report.lost_from - timedelta(hours=13)
    monkeypatch.setattr(matching_service, "list_matchable_found_items", lambda session, object_class_id: [found_item])

    candidates = create_match_candidates_for_lost_report(db, lost_report)

    assert candidates == []
    assert lost_report.status == "OPEN"


def test_found_item_within_early_tolerance_creates_candidate_and_notification(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    lost_report = seed_lost_report(db, 20, status="OPEN", lost_from=utc_now())
    lost_report.latitude = 37.52
    lost_report.longitude = 127.10
    lost_report.color = "검정"
    lost_report.colors = ["검정"]
    lost_report.description = "분실정보"
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=lost_report.lost_from - timedelta(hours=2))
    found_item.latitude = 37.54
    found_item.longitude = 127.10
    found_item.color = "빨강"
    found_item.public_description = "발견정보"
    db.flush()
    monkeypatch.setattr(matching_service, "list_matchable_found_items", lambda session, object_class_id: [found_item])

    candidates = create_match_candidates_for_lost_report(db, lost_report)

    assert len(candidates) == 1
    assert candidates[0].time_score == 20 and candidates[0].area_score == 15 and candidates[0].total_score == 75
    assert lost_report.status == "MATCHED"
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_type="LOST_REPORT", related_id=lost_report.id).count() == 1


def test_reconciliation_updates_five_day_candidate_to_medium_time_score(db: Session) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="MATCHED", lost_from=now - timedelta(days=5))
    report.area_name = "서울"
    report.color = "검정"
    report.colors = ["검정"]
    report.description = "분실정보"
    found = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now)
    found.area_name = "서울"
    found.color = "빨강"
    found.public_description = "발견정보"
    candidate = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now)
    db.add(candidate)
    db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()

    assert candidate.time_score == 15 and candidate.total_score == 80
    assert candidate.status == "NOTIFIED" and report.status == "MATCHED"


def test_reconciliation_dismisses_candidate_that_falls_below_threshold_after_time_rescore(db: Session) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="MATCHED", lost_from=now - timedelta(days=5))
    report.area_name = "서울"
    report.color = "검정"
    report.colors = ["검정"]
    report.description = "희귀표식"
    found = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now)
    found.area_name = "부산"
    found.color = "빨강"
    found.public_description = "희귀표식"
    candidate = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=61, type_score=40, area_score=0, time_score=20, keyword_score=1, status="NOTIFIED", created_at=now, updated_at=now)
    db.add(candidate)
    db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()

    assert candidate.time_score == 15 and candidate.total_score == 56
    assert candidate.status == "DISMISSED" and report.status == "OPEN"


def test_reconciliation_dismisses_time_too_early_candidate_and_reopens_report(db: Session) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    lost_at = utc_now()
    report = seed_lost_report(db, 20, status="MATCHED", lost_from=lost_at)
    found = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=lost_at - timedelta(hours=13))
    candidate = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=85, type_score=40, area_score=25, time_score=20, keyword_score=0, status="NOTIFIED", created_at=lost_at, updated_at=lost_at)
    db.add(candidate)
    db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()

    assert candidate.status == "DISMISSED"
    assert report.status == "OPEN"


def test_reconciliation_recomputes_keyword_score_without_generic_or_color_double_count(db: Session) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="MATCHED", lost_from=now - timedelta(days=5))
    report.area_name = "서울"
    report.color = "검정색"
    report.colors = ["검정색"]
    report.description = "검정 가방을 분실했습니다"
    found = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now)
    found.area_name = "부산"
    found.color = "블랙"
    found.public_description = "블랙 가방 발견"
    candidate = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=67, type_score=40, area_score=0, time_score=15, keyword_score=12, status="NOTIFIED", created_at=now, updated_at=now)
    db.add(candidate)
    db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()

    assert candidate.keyword_score == 10 and candidate.total_score == 65
    assert candidate.status == "NOTIFIED" and report.status == "MATCHED"


def test_reconciliation_dismisses_candidate_when_only_generic_feature_evidence_is_removed(db: Session) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="MATCHED", lost_from=now - timedelta(days=1))
    report.area_name = "서울"
    report.color = "검정"
    report.colors = ["검정"]
    report.description = "물건 신고"
    found = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now)
    found.area_name = "부산"
    found.color = "빨강"
    found.public_description = "물건 신고"
    candidate = MatchCandidate(id=50, lost_report_id=20, found_item_id=10, total_score=61, type_score=40, area_score=0, time_score=20, keyword_score=1, status="NOTIFIED", created_at=now, updated_at=now)
    db.add(candidate)
    db.commit()

    reconcile_match_candidates_for_found_item(db, found)
    db.commit()

    assert candidate.keyword_score == 0 and candidate.total_score == 60
    assert candidate.status == "DISMISSED" and report.status == "OPEN"


def test_color_synonym_creates_candidate_without_feature_double_count(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="OPEN", lost_from=now)
    report.area_name = "서울"
    report.color = "검정색"
    report.colors = ["검정색"]
    report.description = "검정색 가방을 분실했습니다"
    found = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now + timedelta(hours=1))
    found.area_name = "부산"
    found.color = "블랙"
    found.public_description = "블랙 가방 발견"
    db.flush()
    monkeypatch.setattr(matching_service, "list_matchable_found_items", lambda session, object_class_id: [found])

    created = create_match_candidates_for_lost_report(db, report)

    assert len(created) == 1
    assert created[0].keyword_score == 10 and created[0].total_score == 70
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_type="LOST_REPORT", related_id=report.id).count() == 1


def test_type_and_time_only_match_creates_no_candidate_or_notification(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    lost_report = seed_lost_report(db, 20, status="OPEN", lost_from=now)
    lost_report.area_name = "서울"
    lost_report.color = "검정"
    lost_report.colors = ["검정"]
    lost_report.description = "고유 특징 없음"
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=now + timedelta(days=1))
    found_item.area_name = "부산"
    found_item.color = "빨강"
    found_item.public_description = "별도 설명"
    db.flush()
    monkeypatch.setattr(matching_service, "list_matchable_found_items", lambda session, object_class_id: [found_item])

    candidates = create_match_candidates_for_lost_report(db, lost_report)

    assert candidates == []
    assert lost_report.status == "OPEN"
    assert db.query(MatchCandidate).count() == 0
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND").count() == 0


def test_matchable_found_items_only_include_public_available_items(db: Session) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    seed_found_item(db, 11, status="DETECTED", is_public=True)
    seed_found_item(db, 12, status="AVAILABLE", is_public=False)
    db.commit()

    assert [item.id for item in list_matchable_found_items(db, 1)] == [10]


def test_report_top_five_preserves_rows_groups_notifications_and_is_idempotent(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="OPEN", lost_from=now - timedelta(days=1))
    candidates = []
    scores = {}
    for index in range(8):
        found = seed_found_item(db, 10 + index, status="AVAILABLE", is_public=True, found_at=now)
        candidate = MatchCandidate(id=100 + index, lost_report_id=20, found_item_id=found.id, total_score=0, type_score=0, area_score=0, time_score=0, keyword_score=0, status="DISMISSED", created_at=now + timedelta(seconds=index), updated_at=now)
        candidates.append(candidate)
        scores[found.id] = matching_service.MatchScore(90 - index, 40, 25, 20, 5)
    db.add_all(candidates)
    db.commit()

    monkeypatch.setattr(matching_service, "evaluate_match_candidate", lambda lost, found: matching_service.MatchEvaluation(True, scores[found.id], None))
    first_top = matching_service.reconcile_top_match_candidates_for_report(db, report)
    db.flush()

    assert [candidate.id for candidate in first_top] == [100, 101, 102, 103, 104]
    assert [candidate.status for candidate in candidates] == ["NOTIFIED"] * 5 + ["DISMISSED"] * 3
    assert db.query(MatchCandidate).filter_by(lost_report_id=20).count() == 8
    notifications = db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_type="LOST_REPORT", related_id=20).all()
    assert len(notifications) == 1 and notifications[0].message == "새로운 매칭 후보 5건을 찾았어요."

    candidates[0].status = "VIEWED"
    scores[10] = matching_service.MatchScore(86, 40, 25, 20, 1)
    scores[11] = matching_service.MatchScore(90, 40, 25, 20, 5)
    matching_service.reconcile_top_match_candidates_for_report(db, report)
    db.flush()

    assert candidates[0].status == "VIEWED"
    assert db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_type="LOST_REPORT", related_id=20).count() == 1


def test_report_top_five_promotes_multiple_entries_with_one_grouped_notification(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="MATCHED", lost_from=now - timedelta(days=1))
    candidates = []
    scores = {}
    for index in range(8):
        found = seed_found_item(db, 10 + index, status="AVAILABLE", is_public=True, found_at=now)
        candidate = MatchCandidate(id=100 + index, lost_report_id=20, found_item_id=found.id, total_score=90 - index, type_score=40, area_score=25, time_score=20, keyword_score=5, status="NOTIFIED" if index < 5 else "DISMISSED", created_at=now + timedelta(seconds=index), updated_at=now)
        candidates.append(candidate)
        scores[found.id] = matching_service.MatchScore(90 - index, 40, 25, 20, 5)
    db.add_all(candidates)
    db.commit()
    monkeypatch.setattr(matching_service, "evaluate_match_candidate", lambda lost, found: matching_service.MatchEvaluation(True, scores[found.id], None))

    for found_id, total in ((15, 99), (16, 98), (17, 97)):
        scores[found_id] = matching_service.MatchScore(total, 40, 25, 20, 5)
    top = matching_service.reconcile_top_match_candidates_for_report(db, report)
    db.flush()

    assert {candidate.id for candidate in top} == {100, 101, 105, 106, 107}
    assert [c.status for c in candidates[2:5]] == ["DISMISSED"] * 3
    assert [c.status for c in candidates[5:]] == ["NOTIFIED"] * 3
    notifications = db.query(Notification).filter_by(notification_type="MATCH_FOUND", related_type="LOST_REPORT", related_id=20).all()
    assert len(notifications) == 1 and notifications[0].message == "새로운 매칭 후보 3건을 찾았어요."


def test_claimed_candidate_is_separate_from_general_top_five(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    now = utc_now()
    report = seed_lost_report(db, 20, status="CLAIM_PENDING", lost_from=now - timedelta(days=1))
    candidates = []
    scores = {}
    for index in range(7):
        found = seed_found_item(db, 10 + index, status="AVAILABLE", is_public=True, found_at=now)
        candidate = MatchCandidate(id=100 + index, lost_report_id=20, found_item_id=found.id, total_score=70, type_score=40, area_score=25, time_score=0, keyword_score=5, status="CLAIMED" if index == 0 else "DISMISSED", created_at=now + timedelta(seconds=index), updated_at=now)
        candidates.append(candidate)
        scores[found.id] = matching_service.MatchScore(90 - index, 40, 25, 20, 5)
    db.add_all(candidates)
    db.commit()
    monkeypatch.setattr(matching_service, "evaluate_match_candidate", lambda lost, found: matching_service.MatchEvaluation(True, scores[found.id], None))

    top = matching_service.reconcile_top_match_candidates_for_report(db, report)
    db.flush()

    assert candidates[0].status == "CLAIMED"
    assert len(top) == 5
    assert sum(candidate.status in matching_service.GENERAL_ACTIVE_MATCH_STATUSES for candidate in candidates) == 5
    assert report.status == "CLAIM_PENDING"


def test_overlong_location_and_color_validation() -> None:
    aware_time = datetime.now(UTC)

    with pytest.raises(ValidationError):
        LostReportCreateRequest(
            item_category="BAG",
            color="x" * 51,
            description="검정 백팩",
            lost_location="잠실 한강공원",
            lost_at=aware_time,
        )

    with pytest.raises(ValidationError):
        LostReportCreateRequest(
            item_category="BAG",
            color="검정",
            description="검정 백팩",
            lost_location="x" * 101,
            lost_at=aware_time,
        )


def test_naive_lost_at_is_rejected() -> None:
    with pytest.raises(ValidationError):
        LostReportCreateRequest(
            item_category="BAG",
            color="검정",
            description="검정 백팩",
            lost_location="잠실 한강공원",
            lost_at=datetime.now(),
        )


def test_verification_details_min_length_is_checked_after_strip() -> None:
    with pytest.raises(ValidationError):
        OwnershipClaimCreateRequest(
            found_item_id=1,
            verification_details="   short   ",
        )
