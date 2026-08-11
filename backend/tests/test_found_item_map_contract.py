from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_db
from app.main import app
from app.models import FoundItem, ObjectClass


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
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


def seed_object_class(db: Session) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    db.add(
        ObjectClass(
            id=1,
            code="BAG",
            name_ko="가방",
            group_code="PERSONAL_ITEM",
            display_order=1,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
    )


def seed_found_item(
    db: Session,
    item_id: int,
    *,
    status: str,
    is_public: bool = True,
    latitude: Decimal | None = Decimal("37.5200"),
    longitude: Decimal | None = Decimal("127.0200"),
    found_at: datetime | None = None,
) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    db.add(
        FoundItem(
            id=item_id,
            object_class_id=1,
            source_type="ADMIN",
            color="검정",
            public_description=f"지도 공개 발견물 {item_id}",
            private_features="내부 라벨",
            area_name="서울 한강공원 A구역",
            latitude=latitude,
            longitude=longitude,
            found_at=found_at or now,
            status=status,
            storage_location="관리자 보관함",
            admin_memo="관리자 메모",
            is_public=is_public,
            created_at=now,
            updated_at=now,
        )
    )


def test_found_item_map_returns_only_public_available_or_recovered_items_with_coordinates(client: TestClient, db: Session) -> None:
    seed_object_class(db)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    seed_found_item(db, 1, status="RECOVERED", found_at=now)
    seed_found_item(db, 2, status="AVAILABLE", latitude=Decimal("37.5300"), longitude=Decimal("127.0300"), found_at=now + timedelta(hours=1))
    seed_found_item(db, 3, status="DETECTED")
    seed_found_item(db, 4, status="CLAIM_PENDING")
    seed_found_item(db, 5, status="RETURNED")
    seed_found_item(db, 6, status="DISPOSED")
    seed_found_item(db, 7, status="AVAILABLE", is_public=False)
    seed_found_item(db, 8, status="AVAILABLE", latitude=None)
    seed_found_item(db, 9, status="RECOVERED", longitude=None)
    db.commit()

    response = client.get("/api/found-items/map")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [2, 1]
    assert body[0]["latitude"] == 37.53
    assert body[0]["longitude"] == 127.03
    assert body[0]["status"] == "AVAILABLE"
    assert body[1]["status"] == "RECOVERED"

    for item in body:
        assert "private_features" not in item
        assert "storage_location" not in item
        assert "admin_memo" not in item
        assert "registered_by" not in item
        assert "user" not in item


def test_found_item_map_route_is_not_captured_by_detail_route(client: TestClient, db: Session) -> None:
    seed_object_class(db)
    db.commit()

    response = client.get("/api/found-items/map")

    assert response.status_code == 200
    assert response.json() == []
