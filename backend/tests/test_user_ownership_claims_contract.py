from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.ownership as ownership_service
from app.core.security import hash_password, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import FoundItem, LostReport, MatchCandidate, ObjectClass, OwnershipClaim, User


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
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


@pytest.fixture(autouse=True)
def assign_claim_id(monkeypatch: pytest.MonkeyPatch) -> None:
    original = ownership_service.add_ownership_claim

    def add_claim(session: Session, claim: OwnershipClaim) -> OwnershipClaim:
        if claim.id is None:
            claim.id = 9000
        return original(session, claim)

    monkeypatch.setattr(ownership_service, "add_ownership_claim", add_claim)


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


def seed_catalog(db: Session, found_item_ids: range) -> None:
    now = utc_now()
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
    for item_id in found_item_ids:
        db.add(FoundItem(
            id=item_id,
            object_class_id=1,
            source_type="ADMIN",
            color="검정",
            public_description=f"발견물 {item_id}",
            private_features="안쪽 라벨",
            area_name="잠실",
            found_at=now,
            status="AVAILABLE",
            is_public=True,
            created_at=now,
            updated_at=now,
        ))


def login(client: TestClient, user_id: int) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": f"user{user_id}@example.com", "password": "password123"},
    )
    assert response.status_code == 200


def test_my_ownership_claims_require_authentication(client: TestClient) -> None:
    response = client.get("/api/ownership-claims/me")
    assert response.status_code == 401


def test_my_ownership_claims_are_isolated_ordered_and_keep_statuses(
    client: TestClient,
    db: Session,
) -> None:
    now = utc_now()
    seed_user(db, 1)
    seed_user(db, 2)
    seed_catalog(db, range(10, 15))
    statuses = ["PENDING", "APPROVED", "REJECTED", "RETURNED"]
    for index, status in enumerate(statuses):
        db.add(OwnershipClaim(
            id=100 + index,
            user_id=1,
            found_item_id=10 + index,
            verification_details=f"사용자 A 요청 {status}",
            status=status,
            created_at=now + timedelta(minutes=index),
            updated_at=now + timedelta(minutes=index),
        ))
    db.add(OwnershipClaim(
        id=200,
        user_id=2,
        found_item_id=14,
        verification_details="사용자 B 요청",
        status="PENDING",
        created_at=now + timedelta(minutes=10),
        updated_at=now + timedelta(minutes=10),
    ))
    db.commit()
    login(client, 1)

    response = client.get("/api/ownership-claims/me")

    assert response.status_code == 200
    claims = response.json()
    assert [claim["id"] for claim in claims] == [103, 102, 101, 100]
    assert [claim["status"] for claim in claims] == ["RETURNED", "REJECTED", "APPROVED", "PENDING"]
    assert {claim["user_id"] for claim in claims} == {1}
    assert all(claim["id"] != 200 for claim in claims)


def test_my_ownership_claims_support_pagination(client: TestClient, db: Session) -> None:
    now = utc_now()
    seed_user(db, 1)
    seed_catalog(db, range(10, 13))
    for index in range(3):
        db.add(OwnershipClaim(
            id=100 + index,
            user_id=1,
            found_item_id=10 + index,
            verification_details=f"페이지 요청 {index}",
            status="PENDING",
            created_at=now + timedelta(minutes=index),
            updated_at=now + timedelta(minutes=index),
        ))
    db.commit()
    login(client, 1)

    response = client.get("/api/ownership-claims/me", params={"skip": 1, "limit": 1})

    assert response.status_code == 200
    assert [claim["id"] for claim in response.json()] == [101]
    assert client.get("/api/ownership-claims/me", params={"skip": -1}).status_code == 422
    assert client.get("/api/ownership-claims/me", params={"limit": 101}).status_code == 422


def test_create_ownership_claim_still_works(client: TestClient, db: Session) -> None:
    seed_user(db, 1)
    seed_catalog(db, range(10, 11))
    db.commit()
    login(client, 1)

    response = client.post(
        "/api/ownership-claims",
        json={
            "found_item_id": 10,
            "lost_report_id": None,
            "verification_details": "안쪽 라벨과 고유한 스티커 위치를 설명합니다.",
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "PENDING"
    assert response.json()["user_id"] == 1


def test_second_user_cannot_claim_item_after_first_claim(client: TestClient, db: Session) -> None:
    now = utc_now()
    seed_user(db, 1)
    seed_user(db, 2)
    seed_catalog(db, range(10, 11))
    db.add_all([
        LostReport(id=20, user_id=1, object_class_id=1, colors=[], description="A 신고", area_name="서울", lost_from=now, status="MATCHED", created_at=now, updated_at=now),
        LostReport(id=21, user_id=2, object_class_id=1, colors=[], description="B 신고", area_name="서울", lost_from=now, status="MATCHED", created_at=now, updated_at=now),
        MatchCandidate(id=30, lost_report_id=20, found_item_id=10, total_score=80, type_score=40, area_score=25, time_score=15, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now),
        MatchCandidate(id=31, lost_report_id=21, found_item_id=10, total_score=80, type_score=40, area_score=25, time_score=15, keyword_score=0, status="NOTIFIED", created_at=now, updated_at=now),
    ])
    db.commit()
    login(client, 1)

    first = client.post("/api/ownership-claims", json={"found_item_id": 10, "lost_report_id": 20, "verification_details": "A의 고유 특징을 자세히 설명합니다."})
    assert first.status_code == 201
    client.cookies.clear()
    login(client, 2)
    second = client.post("/api/ownership-claims", json={"found_item_id": 10, "lost_report_id": 21, "verification_details": "B의 특징을 자세히 설명합니다."})

    assert second.status_code == 404
    assert db.query(OwnershipClaim).count() == 1
    assert db.get(MatchCandidate, 31).status == "DISMISSED"
