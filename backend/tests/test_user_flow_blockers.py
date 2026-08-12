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
from app.services.matching import create_match_candidates_for_lost_report
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


def test_rejected_claim_reconciles_and_restores_still_valid_candidate(db: Session) -> None:
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
    assert candidate.status == "NOTIFIED"
    assert candidate.total_score == 70
    assert (candidate.type_score, candidate.area_score, candidate.time_score, candidate.keyword_score) == (40, 0, 20, 10)
    assert lost_report.status == "MATCHED"
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


def test_found_item_before_lost_time_is_excluded_from_matching(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    lost_report = seed_lost_report(db, 20, status="OPEN")
    found_item = seed_found_item(db, 10, status="AVAILABLE", is_public=True, found_at=lost_report.lost_from - timedelta(seconds=1))
    db.flush()
    found_item.found_at = lost_report.lost_from - timedelta(seconds=1)
    monkeypatch.setattr(matching_service, "list_matchable_found_items", lambda session, object_class_id: [found_item])

    candidates = create_match_candidates_for_lost_report(db, lost_report)

    assert candidates == []
    assert lost_report.status == "OPEN"


def test_matchable_found_items_only_include_public_available_items(db: Session) -> None:
    seed_user(db, 1)
    seed_object_class(db, 1, "BAG")
    seed_found_item(db, 10, status="AVAILABLE", is_public=True)
    seed_found_item(db, 11, status="DETECTED", is_public=True)
    seed_found_item(db, 12, status="AVAILABLE", is_public=False)
    db.commit()

    assert [item.id for item in list_matchable_found_items(db, 1)] == [10]


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
