from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import FoundItem, LostReport, MatchCandidate, ObjectClass, User


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, autoflush=False, expire_on_commit=False)
    with factory() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def seed_user(db: Session, user_id: int) -> None:
    now = utc_now()
    db.add(User(
        id=user_id,
        email=f"user{user_id}@example.com",
        password_hash=hash_password("password123"),
        nickname=f"user{user_id}",
        role="USER",
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
    ))


def seed_data(db: Session) -> None:
    now = utc_now()
    seed_user(db, 1)
    seed_user(db, 2)
    db.add(ObjectClass(
        id=1,
        code="BAG",
        name_ko="가방",
        group_code="PERSONAL_ITEM",
        display_order=1,
        is_active=True,
        created_at=now,
        updated_at=now,
    ))
    db.add_all([
        LostReport(id=10, user_id=1, object_class_id=1, colors=[], description="A", area_name="서울", lost_from=now, status="OPEN", created_at=now, updated_at=now),
        LostReport(id=20, user_id=1, object_class_id=1, colors=[], description="B", area_name="서울", lost_from=now, status="OPEN", created_at=now, updated_at=now),
        LostReport(id=30, user_id=2, object_class_id=1, colors=[], description="foreign", area_name="서울", lost_from=now, status="OPEN", created_at=now, updated_at=now),
    ])
    candidate_id = 100
    for report_id, count, base_score in ((10, 25, 70), (20, 3, 20), (30, 1, 99)):
        for index in range(count):
            item_id = candidate_id
            created_at = now + timedelta(seconds=index // 2)
            db.add(FoundItem(
                id=item_id,
                object_class_id=1,
                source_type="ADMIN",
                public_description=f"item {item_id}",
                area_name="서울",
                found_at=now,
                status="AVAILABLE",
                is_public=True,
                created_at=now,
                updated_at=now,
            ))
            db.add(MatchCandidate(
                id=candidate_id,
                lost_report_id=report_id,
                found_item_id=item_id,
                total_score=base_score + index,
                type_score=20,
                area_score=0,
                time_score=0,
                keyword_score=0,
                status="NOTIFIED" if report_id != 10 or index >= 20 else "DISMISSED",
                created_at=created_at,
                updated_at=now,
            ))
            candidate_id += 1
    db.add(FoundItem(id=999, object_class_id=1, source_type="ADMIN", area_name="서울", found_at=now, status="AVAILABLE", is_public=True, created_at=now, updated_at=now))
    db.add(MatchCandidate(id=999, lost_report_id=20, found_item_id=999, total_score=100, type_score=40, area_score=25, time_score=20, keyword_score=15, status="DISMISSED", created_at=now, updated_at=now))
    db.commit()


def login(client: TestClient) -> None:
    response = client.post("/api/auth/login", json={"email": "user1@example.com", "password": "password123"})
    assert response.status_code == 200


def test_matches_without_report_filter_remain_global(client: TestClient, db: Session) -> None:
    seed_data(db)
    login(client)

    response = client.get("/api/matches/me", params={"limit": 100})

    assert response.status_code == 200
    assert len(response.json()) == 8
    assert {match["lost_report"]["id"] for match in response.json()} == {10, 20}
    assert all(match["id"] != 999 for match in response.json())


def test_report_filter_runs_before_pagination_and_excludes_dismissed(client: TestClient, db: Session) -> None:
    seed_data(db)
    login(client)

    response = client.get("/api/matches/me", params={"lost_report_id": 20})

    assert response.status_code == 200
    assert [match["id"] for match in response.json()] == [127, 126, 125]
    assert {match["lost_report"]["id"] for match in response.json()} == {20}


def test_report_specific_pagination_and_deterministic_order(client: TestClient, db: Session) -> None:
    seed_data(db)
    now = utc_now()
    for candidate_id in (125, 126, 127):
        candidate = db.get(MatchCandidate, candidate_id)
        assert candidate is not None
        candidate.total_score = 50
        candidate.created_at = now
    db.commit()
    login(client)

    response = client.get("/api/matches/me", params={"lost_report_id": 20, "skip": 1, "limit": 1})

    assert response.status_code == 200
    assert [match["id"] for match in response.json()] == [126]


def test_foreign_report_id_does_not_leak_candidates(client: TestClient, db: Session) -> None:
    seed_data(db)
    login(client)

    response = client.get("/api/matches/me", params={"lost_report_id": 30})

    assert response.status_code == 200
    assert response.json() == []


def test_progress_batch_is_report_scoped_beyond_global_limit_and_blocks_foreign_reports(client: TestClient, db: Session) -> None:
    seed_data(db)
    now = utc_now()
    for index in range(101):
        item_id = 2000 + index
        db.add(FoundItem(id=item_id, object_class_id=1, source_type="ADMIN", area_name="서울", found_at=now, status="AVAILABLE", is_public=True, created_at=now, updated_at=now))
        db.add(MatchCandidate(id=item_id, lost_report_id=10, found_item_id=item_id, total_score=1000 - index, type_score=40, area_score=25, time_score=20, keyword_score=15, status="NOTIFIED", created_at=now, updated_at=now))
    db.commit()
    login(client)

    global_matches = client.get("/api/matches/me", params={"limit": 100}).json()
    response = client.get("/api/matches/me/progress", params=[("lost_report_ids", 20), ("lost_report_ids", 30)])

    assert all(match["lost_report"]["id"] != 20 for match in global_matches)
    assert response.status_code == 200
    assert [match["id"] for match in response.json()] == [127, 126, 125]
    assert {match["lost_report"]["id"] for match in response.json()} == {20}


def test_progress_batch_rejects_empty_oversized_and_invalid_report_lists(client: TestClient, db: Session) -> None:
    seed_data(db); login(client)
    assert client.get("/api/matches/me/progress").status_code == 422
    assert client.get("/api/matches/me/progress", params={"lost_report_ids": 0}).status_code == 422
    assert client.get("/api/matches/me/progress", params=[("lost_report_ids", value) for value in range(1, 22)]).status_code == 422


def test_stale_candidate_for_unmatchable_item_is_hidden_but_claimed_candidate_remains_visible(
    client: TestClient,
    db: Session,
) -> None:
    seed_data(db)
    found_item = db.get(FoundItem, 125)
    claimant_candidate = db.get(MatchCandidate, 125)
    stale_candidate = db.get(MatchCandidate, 128)
    assert found_item is not None and claimant_candidate is not None and stale_candidate is not None
    found_item.status = "CLAIM_PENDING"
    claimant_candidate.status = "CLAIMED"
    stale_candidate.found_item_id = 125
    stale_candidate.status = "NOTIFIED"
    db.commit()

    login(client)
    claimant_response = client.get("/api/matches/me", params={"lost_report_id": 20})
    assert [match["id"] for match in claimant_response.json()] == [127, 126, 125]
    client.cookies.clear()
    response = client.post("/api/auth/login", json={"email": "user2@example.com", "password": "password123"})
    assert response.status_code == 200
    stale_response = client.get("/api/matches/me", params={"lost_report_id": 30})
    assert stale_response.status_code == 200
    assert stale_response.json() == []


@pytest.mark.parametrize(
    "params",
    [
        {"lost_report_id": 0},
        {"lost_report_id": -1},
        {"lost_report_id": "invalid"},
        {"skip": -1},
        {"limit": 0},
        {"limit": 101},
    ],
)
def test_match_query_validation(client: TestClient, db: Session, params: dict[str, object]) -> None:
    seed_data(db)
    login(client)

    assert client.get("/api/matches/me", params=params).status_code == 422
