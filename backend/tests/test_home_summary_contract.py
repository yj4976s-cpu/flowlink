from collections.abc import Iterator
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import CitizenReport, DetectedObject, DetectionEvent, FoundItem, LostReport, MatchCandidate, ObjectClass, User


@compiles(BigInteger, "sqlite")
def compile_big_integer_for_sqlite(_type, _compiler, **_kwargs) -> str:
    return "INTEGER"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    with factory() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: (yield db)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def seed_user_and_classes(db: Session) -> tuple[User, ObjectClass, ObjectClass]:
    now = utc_now()
    user = User(id=1, email="home@example.com", password_hash="unused", nickname="home", role="USER", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now)
    bag = ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now)
    ball = ObjectClass(id=2, code="BALL", name_ko="공", group_code="PERSONAL_ITEM", display_order=2, is_active=True, created_at=now, updated_at=now)
    db.add_all([user, bag, ball])
    db.commit()
    return user, bag, ball


def add_found_item(db: Session, object_class: ObjectClass, *, item_id: int, minutes_ago: int, status: str = "AVAILABLE", is_public: bool = True, detected_object_id: int | None = None) -> FoundItem:
    found_at = utc_now() - timedelta(minutes=minutes_ago)
    item = FoundItem(
        id=item_id,
        detected_object_id=detected_object_id,
        object_class_id=object_class.id,
        registered_by=None,
        source_type="AI" if detected_object_id else "ADMIN",
        color="검정",
        public_description=f"공개 발견물 {item_id}",
        private_features="private feature must not leak",
        area_name=f"공개 위치 {item_id}",
        found_at=found_at,
        status=status,
        storage_location="admin-only shelf",
        admin_memo="admin memo must not leak",
        is_public=is_public,
        created_at=found_at,
        updated_at=found_at,
    )
    db.add(item)
    db.commit()
    return item


def add_detection_with_object(db: Session, object_class: ObjectClass, *, event_id: int, object_id: int, created_offset_hours: int = 0, confidence: Decimal = Decimal("0.92")) -> DetectedObject:
    now = utc_now() + timedelta(hours=created_offset_hours)
    event = DetectionEvent(
        id=event_id,
        source_type="IMAGE",
        original_media_url="/uploads/detections/home.jpg",
        status="COMPLETED",
        captured_at=now,
        created_at=now,
        updated_at=now,
    )
    detected = DetectedObject(
        id=object_id,
        detection_event_id=event_id,
        object_class_id=object_class.id,
        processing_status="CONFIRMED",
        confidence=confidence,
        bbox_x=Decimal("1"),
        bbox_y=Decimal("1"),
        bbox_width=Decimal("10"),
        bbox_height=Decimal("10"),
        detected_at=now,
        created_at=now,
    )
    db.add_all([event, detected])
    db.commit()
    return detected


def test_home_summary_returns_empty_public_payload(client: TestClient) -> None:
    response = client.get("/api/system/home-summary")

    assert response.status_code == 200
    assert response.json() == {
        "stats": {"recent_found": 0, "matching_active": 0, "returned": 0, "today_detections": 0},
        "recent_items": [],
    }


def test_home_summary_counts_public_data_and_limits_recent_items(client: TestClient, db: Session) -> None:
    user, bag, ball = seed_user_and_classes(db)
    detected = add_detection_with_object(db, bag, event_id=1, object_id=1)
    add_detection_with_object(db, ball, event_id=2, object_id=2, created_offset_hours=-48, confidence=Decimal("0.80"))
    public_items = [
        add_found_item(db, bag if index % 2 else ball, item_id=index, minutes_ago=index, detected_object_id=detected.id if index == 1 else None)
        for index in range(1, 6)
    ]
    add_found_item(db, bag, item_id=20, minutes_ago=0, is_public=False)
    add_found_item(db, bag, item_id=21, minutes_ago=0, status="RETURNED")
    cancelled = add_found_item(db, bag, item_id=22, minutes_ago=0)
    db.add(CitizenReport(user_id=user.id, object_class_id=bag.id, description="cancelled report", area_name="hidden", found_at=utc_now(), status="CANCELLED", linked_found_item_id=cancelled.id, created_at=utc_now(), updated_at=utc_now()))
    lost = LostReport(id=1, user_id=user.id, object_class_id=bag.id, description="lost", area_name="home", lost_from=utc_now(), status="OPEN", created_at=utc_now(), updated_at=utc_now())
    db.add_all([
        lost,
        MatchCandidate(id=1, lost_report_id=1, found_item_id=public_items[0].id, total_score=80, type_score=40, area_score=20, time_score=20, keyword_score=0, status="NOTIFIED", created_at=utc_now(), updated_at=utc_now()),
        MatchCandidate(id=2, lost_report_id=1, found_item_id=public_items[1].id, total_score=70, type_score=40, area_score=15, time_score=15, keyword_score=0, status="VIEWED", created_at=utc_now(), updated_at=utc_now()),
        MatchCandidate(id=3, lost_report_id=1, found_item_id=public_items[2].id, total_score=60, type_score=40, area_score=10, time_score=10, keyword_score=0, status="DISMISSED", created_at=utc_now(), updated_at=utc_now()),
    ])
    db.commit()

    response = client.get("/api/system/home-summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["stats"] == {"recent_found": 5, "matching_active": 2, "returned": 1, "today_detections": 1}
    assert [item["id"] for item in payload["recent_items"]] == [1, 2, 3, 4]
    assert len(payload["recent_items"]) == 4
    assert payload["recent_items"][0]["image_url"] == "/uploads/detections/home.jpg"
    assert payload["recent_items"][0]["confidence"] == 92
    assert payload["recent_items"][0]["object_kind"] == "backpack"
    assert all(item["id"] not in {20, 21, 22} for item in payload["recent_items"])
    response_text = response.text
    assert "storage_location" not in response_text
    assert "admin_memo" not in response_text
    assert "private_features" not in response_text
    assert "user_id" not in response_text
    assert "registered_by" not in response_text
