from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password, utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import AdminNotification, Camera, CitizenReport, DetectedObject, DetectionEvent, ObjectClass, OwnershipClaim, ProcessingHistory, User
from app.services.admin_notifications import (
    CITIZEN_REPORT_REVIEW_REQUIRED,
    OPERATION_DETECTION_REVIEW_REQUIRED,
    OWNERSHIP_CLAIM_REVIEW_REQUIRED,
    OWNERSHIP_RETURN_REQUIRED,
    WASTE_COLLECTION_REQUIRED,
    create_admin_notification_once,
    sync_citizen_report_notification,
    sync_detected_object_follow_up_notifications,
    sync_detection_review_notification,
    sync_ownership_claim_notifications,
)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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


def seed_user(db: Session, user_id: int, *, role: str = "USER", email: str | None = None) -> User:
    now = utc_now()
    user = User(
        id=user_id,
        email=email or f"user{user_id}@example.com",
        password_hash=hash_password("password123"),
        nickname=f"user{user_id}",
        role=role,
        active=True,
        terms_agreed_at=now,
        privacy_agreed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    return user


def login(client: TestClient, email: str) -> None:
    response = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert response.status_code == 200


def seed_operation_object(db: Session, *, object_id: int = 100, processing_status: str = "PENDING", group_code: str = "PERSONAL_ITEM") -> DetectedObject:
    now = utc_now()
    object_class = ObjectClass(
        id=10,
        code="BAG" if group_code == "PERSONAL_ITEM" else "TRASH",
        name_ko="가방" if group_code == "PERSONAL_ITEM" else "폐기물",
        group_code=group_code,
        display_order=1,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    camera = Camera(id=5, code="cam", name="운영 카메라", area_name="운영 구역", is_active=True, created_at=now, updated_at=now)
    event = DetectionEvent(
        id=50,
        camera_id=5,
        user_id=99,
        purpose="OPERATION",
        source_type="IMAGE",
        original_media_url="detections/admin/sample.jpg",
        status="COMPLETED",
        captured_at=now,
        processing_started_at=now,
        processing_completed_at=now,
        created_at=now,
        updated_at=now,
    )
    detected = DetectedObject(
        id=object_id,
        detection_event_id=50,
        object_class_id=10,
        processing_status=processing_status,
        confidence=Decimal("0.8200"),
        bbox_x=Decimal("1"),
        bbox_y=Decimal("1"),
        bbox_width=Decimal("10"),
        bbox_height=Decimal("10"),
        detected_at=now,
        created_at=now,
    )
    db.add_all([object_class, camera, event, detected])
    db.commit()
    return detected


def test_admin_notifications_require_admin(client: TestClient, db: Session) -> None:
    seed_user(db, 1, email="user@example.com")
    seed_user(db, 99, role="ADMIN", email="admin@example.com")
    db.commit()

    assert client.get("/api/admin/notifications").status_code == 401
    login(client, "user@example.com")
    assert client.get("/api/admin/notifications").status_code == 403
    client.cookies.clear()
    login(client, "admin@example.com")
    assert client.get("/api/admin/notifications").status_code == 200


def test_admin_read_state_is_per_admin_and_idempotent(client: TestClient, db: Session) -> None:
    seed_user(db, 99, role="ADMIN", email="admin1@example.com")
    seed_user(db, 100, role="ADMIN", email="admin2@example.com")
    create_admin_notification_once(
        db,
        notification_type=OPERATION_DETECTION_REVIEW_REQUIRED,
        related_type="DETECTION_EVENT",
        related_id=10,
    )
    db.commit()

    login(client, "admin1@example.com")
    first = client.get("/api/admin/notifications").json()
    notification_id = first["items"][0]["id"]
    assert first["unread_count"] == 1
    assert client.patch(f"/api/admin/notifications/{notification_id}/read").status_code == 200
    assert client.patch(f"/api/admin/notifications/{notification_id}/read").status_code == 200
    assert client.get("/api/admin/notifications").json()["unread_count"] == 0

    client.cookies.clear()
    login(client, "admin2@example.com")
    assert client.get("/api/admin/notifications").json()["unread_count"] == 1


def test_admin_notification_filters_and_read_all(client: TestClient, db: Session) -> None:
    seed_user(db, 99, role="ADMIN", email="admin@example.com")
    create_admin_notification_once(db, notification_type=OPERATION_DETECTION_REVIEW_REQUIRED, related_type="DETECTION_EVENT", related_id=10)
    create_admin_notification_once(db, notification_type=CITIZEN_REPORT_REVIEW_REQUIRED, related_type="CITIZEN_REPORT", related_id=20)
    resolved = db.scalar(select(AdminNotification).where(AdminNotification.related_id == 20))
    assert resolved is not None
    resolved.resolved_at = utc_now()
    db.commit()

    login(client, "admin@example.com")
    assert client.get("/api/admin/notifications?filter=all").json()["total"] == 2
    assert client.get("/api/admin/notifications?filter=actionable").json()["total"] == 1
    assert client.get("/api/admin/notifications?filter=resolved").json()["total"] == 1
    response = client.post("/api/admin/notifications/read-all")
    assert response.status_code == 200
    assert response.json()["marked_read_count"] == 2
    assert client.get("/api/admin/notifications?filter=unread").json()["total"] == 0
    assert client.post("/api/admin/notifications/read-all").json()["marked_read_count"] == 0


def test_admin_notification_duplicate_creation_does_not_rollback_outer_work(db: Session) -> None:
    seed_user(db, 99, role="ADMIN", email="admin@example.com")
    create_admin_notification_once(db, notification_type=OPERATION_DETECTION_REVIEW_REQUIRED, related_type="DETECTION_EVENT", related_id=10)
    user = User(
        id=2,
        email="later@example.com",
        password_hash=hash_password("password123"),
        nickname="later",
        role="USER",
        active=True,
        terms_agreed_at=utc_now(),
        privacy_agreed_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(user)
    create_admin_notification_once(db, notification_type=OPERATION_DETECTION_REVIEW_REQUIRED, related_type="DETECTION_EVENT", related_id=10)
    db.commit()

    assert db.scalar(select(User).where(User.id == 2)) is not None
    assert db.scalar(select(func.count(AdminNotification.id)).where(AdminNotification.related_id == 10)) == 1


def test_operation_detection_and_follow_up_notifications_sync(db: Session) -> None:
    seed_user(db, 99, role="ADMIN", email="admin@example.com")
    detected = seed_operation_object(db, processing_status="PENDING")
    sync_detection_review_notification(db, detected.detection_event)
    db.commit()

    review = db.scalar(select(AdminNotification).where(AdminNotification.notification_type == OPERATION_DETECTION_REVIEW_REQUIRED))
    assert review is not None
    assert review.resolved_at is None

    detected.processing_status = "CONFIRMED"
    sync_detected_object_follow_up_notifications(db, detected)
    db.commit()

    assert review.resolved_at is not None
    follow_up = db.scalar(select(AdminNotification).where(AdminNotification.notification_type == "FOUND_ITEM_REGISTRATION_REQUIRED"))
    assert follow_up is not None
    assert follow_up.related_type == "DETECTED_OBJECT"


def test_waste_citizen_and_ownership_notifications_sync(db: Session) -> None:
    seed_user(db, 1, email="user@example.com")
    seed_user(db, 99, role="ADMIN", email="admin@example.com")
    waste = seed_operation_object(db, object_id=101, processing_status="CONFIRMED", group_code="WASTE")
    sync_detected_object_follow_up_notifications(db, waste)

    report = CitizenReport(
        id=201,
        user_id=1,
        object_class_id=10,
        description="시민 제보",
        area_name="운영 구역",
        found_at=utc_now(),
        status="PENDING",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(report)
    sync_citizen_report_notification(db, report)

    claim = OwnershipClaim(
        id=301,
        user_id=1,
        found_item_id=1,
        verification_details="safe",
        status="PENDING",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(claim)
    sync_ownership_claim_notifications(db, claim)
    db.flush()

    assert db.scalar(select(AdminNotification).where(AdminNotification.notification_type == WASTE_COLLECTION_REQUIRED)) is not None
    assert db.scalar(select(AdminNotification).where(AdminNotification.notification_type == CITIZEN_REPORT_REVIEW_REQUIRED)) is not None
    assert db.scalar(select(AdminNotification).where(AdminNotification.notification_type == OWNERSHIP_CLAIM_REVIEW_REQUIRED)) is not None

    report.status = "LINKED"
    sync_citizen_report_notification(db, report)
    claim.status = "APPROVED"
    sync_ownership_claim_notifications(db, claim)
    db.commit()

    citizen = db.scalar(select(AdminNotification).where(AdminNotification.notification_type == CITIZEN_REPORT_REVIEW_REQUIRED))
    claim_review = db.scalar(select(AdminNotification).where(AdminNotification.notification_type == OWNERSHIP_CLAIM_REVIEW_REQUIRED))
    claim_return = db.scalar(select(AdminNotification).where(AdminNotification.notification_type == OWNERSHIP_RETURN_REQUIRED))
    assert citizen is not None and citizen.resolved_at is not None
    assert claim_review is not None and claim_review.resolved_at is not None
    assert claim_return is not None and claim_return.resolved_at is None
