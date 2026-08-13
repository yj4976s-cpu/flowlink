from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.ownership as ownership_service
from app.core.security import hash_password, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import CitizenReport, FoundItem, LostReport, MatchCandidate, Notification, ObjectClass, OwnershipClaim, ProcessingHistory, User


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, class_=Session, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
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
def patch_bigint_identity_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    counters = {"history": 2000, "notification": 3000}

    def add_history(session: Session, history: ProcessingHistory) -> ProcessingHistory:
        counters["history"] += 1
        history.id = counters["history"]
        session.add(history)
        session.flush()
        return history

    def add_notification(session: Session, notification: Notification) -> Notification:
        counters["notification"] += 1
        notification.id = counters["notification"]
        session.add(notification)
        session.flush()
        return notification

    monkeypatch.setattr(ownership_service, "add_processing_history", add_history)
    monkeypatch.setattr(ownership_service, "add_notification", add_notification)


def seed_user(db: Session, user_id: int, *, role: str = "USER", email: str | None = None, nickname: str | None = None) -> User:
    now = utc_now()
    user = User(
        id=user_id,
        email=email or f"user{user_id}@example.com",
        password_hash=hash_password("password123"),
        nickname=nickname or f"user{user_id}",
        role=role,
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    return user


def seed_object_class(db: Session) -> ObjectClass:
    now = utc_now()
    object_class = ObjectClass(
        id=1,
        code="BAG",
        name_ko="가방",
        group_code="PERSONAL_ITEM",
        display_order=1,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(object_class)
    return object_class


def seed_found_item(db: Session, *, status: str = "CLAIM_PENDING") -> FoundItem:
    now = utc_now()
    found_item = FoundItem(
        id=10,
        object_class_id=1,
        source_type="ADMIN",
        color="검정",
        public_description="검정 백팩 발견",
        private_features="안쪽 라벨에 FLOW 스티커",
        area_name="잠실 한강공원",
        found_at=now,
        status=status,
        is_public=True,
        storage_location="관리자 보관함 A",
        created_at=now,
        updated_at=now,
    )
    db.add(found_item)
    return found_item


def seed_lost_report(db: Session, *, status: str = "CLAIM_PENDING") -> LostReport:
    now = utc_now()
    lost_report = LostReport(
        id=20,
        user_id=1,
        object_class_id=1,
        color="검정",
        description="안쪽 라벨에 스티커가 있는 검정 백팩",
        area_name="잠실 한강공원",
        lost_from=now,
        status=status,
        created_at=now,
        updated_at=now,
    )
    db.add(lost_report)
    return lost_report


def seed_claim(db: Session, *, lost_report_id: int | None = 20, status: str = "PENDING") -> OwnershipClaim:
    now = utc_now()
    claim = OwnershipClaim(
        id=30,
        user_id=1,
        found_item_id=10,
        lost_report_id=lost_report_id,
        verification_details="안쪽 라벨과 스티커 위치를 설명할 수 있습니다.",
        status=status,
        created_at=now,
        updated_at=now,
    )
    db.add(claim)
    return claim


def seed_admin_claim_data(db: Session, *, lost_report: bool = True, claim_status: str = "PENDING") -> None:
    seed_user(db, 1, nickname="claimant")
    seed_user(db, 2, email="user@example.com")
    seed_user(db, 99, role="ADMIN", email="admin@example.com", nickname="admin")
    seed_object_class(db)
    seed_found_item(db)
    if lost_report:
        seed_lost_report(db)
    seed_claim(db, lost_report_id=20 if lost_report else None, status=claim_status)
    db.commit()


def login(client: TestClient, email: str) -> None:
    response = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert response.status_code == 200


def test_admin_ownership_claims_return_rich_review_response(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)
    login(client, "admin@example.com")

    response = client.get("/api/admin/ownership-claims")

    assert response.status_code == 200
    claim = response.json()[0]
    assert claim["id"] == 30
    assert claim["verification_details"] == "안쪽 라벨과 스티커 위치를 설명할 수 있습니다."
    assert claim["claimant"] == {"id": 1, "nickname": "claimant"}
    assert "email" not in claim["claimant"]
    assert "password_hash" not in claim["claimant"]
    assert claim["found_item"]["private_features"] == "안쪽 라벨에 FLOW 스티커"
    assert claim["found_item"]["item_category"] == "BAG"
    assert claim["found_item"]["item_category_name"] == "가방"
    assert "storage_location" not in claim["found_item"]
    assert "latitude" not in claim["found_item"]
    assert claim["lost_report"]["description"] == "안쪽 라벨에 스티커가 있는 검정 백팩"
    assert claim["lost_report"]["status"] == "CLAIM_PENDING"


def test_admin_ownership_claims_handle_null_lost_report(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db, lost_report=False)
    login(client, "admin@example.com")

    response = client.get("/api/admin/ownership-claims")

    assert response.status_code == 200
    assert response.json()[0]["lost_report"] is None


def test_admin_ownership_claims_keep_admin_authorization(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)

    unauthenticated = client.get("/api/admin/ownership-claims")
    login(client, "user@example.com")
    forbidden = client.get("/api/admin/ownership-claims")

    assert unauthenticated.status_code == 401
    assert forbidden.status_code == 403


def test_admin_dashboard_returns_today_operational_summary(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)
    now = utc_now()
    db.add_all([
        CitizenReport(id=50, user_id=1, object_class_id=1, color="검정", description="검정 백팩을 봤습니다.", area_name="잠실 한강공원", found_at=now, status="PENDING", created_at=now, updated_at=now),
        CitizenReport(id=51, user_id=1, object_class_id=1, color="파랑", description="파란 가방을 봤습니다.", area_name="잠실 한강공원", found_at=now, status="UNDER_REVIEW", created_at=now, updated_at=now),
        OwnershipClaim(id=31, user_id=1, found_item_id=10, lost_report_id=20, verification_details="승인된 요청입니다.", status="APPROVED", created_at=now, updated_at=now),
    ])
    db.commit()
    login(client, "admin@example.com")

    response = client.get("/api/admin/dashboard")

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["discovered"] == 1
    assert body["metrics"]["ai_detections"] == 0
    assert body["metrics"]["official_found_items"] == 1
    assert body["metrics"]["lost_reports"] == 1
    assert body["metrics"]["match_notifications"] == 0
    assert body["metrics"]["claims"] == 2
    assert body["metrics"]["operation_detection_pending"] == 0
    assert body["metrics"]["citizen_pending"] == 2
    assert body["metrics"]["citizen_review_pending"] == 1
    assert body["metrics"]["ownership_claim_pending"] == 1
    assert body["metrics"]["ownership_return_pending"] == 1
    assert body["recent_items"][0]["item_category"] == "BAG"
    assert body["category_counts"] == []
    assert body["claim_status_counts"] == [{"status": "APPROVED", "count": 1}, {"status": "PENDING", "count": 1}]
    assert body["latest_flow"] is None
    assert {item["kind"] for item in body["recent_activity"]} >= {"LOGIN", "LOST_REPORT", "CLAIM"}


def test_admin_dashboard_supports_operational_periods(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)
    login(client, "admin@example.com")

    for period in ("today", "7d", "all"):
        response = client.get("/api/admin/dashboard", params={"period": period})
        assert response.status_code == 200
        assert response.json()["period"] == period
        assert isinstance(response.json()["trend"], list)

    assert client.get("/api/admin/dashboard", params={"period": "30d"}).status_code == 422


def test_admin_dashboard_latest_flow_skips_dismissed_candidate(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)
    now = utc_now()
    db.add_all([
        MatchCandidate(id=40, lost_report_id=20, found_item_id=10, total_score=80, type_score=40, area_score=25, time_score=10, keyword_score=5, status="NOTIFIED", created_at=now, updated_at=now),
        MatchCandidate(id=41, lost_report_id=20, found_item_id=10, total_score=50, type_score=40, area_score=0, time_score=10, keyword_score=0, status="DISMISSED", created_at=now, updated_at=now),
    ])
    db.commit(); login(client, "admin@example.com")

    response = client.get("/api/admin/dashboard")
    assert response.status_code == 200
    assert response.json()["latest_flow"]["match_candidate_id"] == 40


def test_admin_dashboard_latest_flow_is_null_when_only_dismissed_candidates_exist(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)
    now = utc_now()
    db.add(MatchCandidate(id=42, lost_report_id=20, found_item_id=10, total_score=50, type_score=40, area_score=0, time_score=10, keyword_score=0, status="DISMISSED", created_at=now, updated_at=now))
    db.commit(); login(client, "admin@example.com")

    response = client.get("/api/admin/dashboard")
    assert response.status_code == 200
    assert response.json()["latest_flow"] is None


def test_admin_ownership_claim_patch_returns_rich_response(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)
    login(client, "admin@example.com")

    response = client.patch(
        "/api/admin/ownership-claims/30",
        json={"status": "APPROVED", "admin_memo": "특징이 일치합니다."},
    )

    assert response.status_code == 200
    claim = response.json()
    assert claim["status"] == "APPROVED"
    assert claim["reviewed_by"] == 99
    assert claim["admin_memo"] == "특징이 일치합니다."
    assert claim["found_item"]["status"] == "CLAIM_PENDING"
    assert claim["lost_report"]["status"] == "CLAIM_PENDING"
    assert claim["claimant"] == {"id": 1, "nickname": "claimant"}


def test_admin_ownership_claim_patch_rejects_invalid_transition(client: TestClient, db: Session) -> None:
    seed_admin_claim_data(db)
    login(client, "admin@example.com")

    response = client.patch("/api/admin/ownership-claims/30", json={"status": "RETURNED"})

    assert response.status_code == 409
