import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password
from app.db.session import Base, get_db
from app.main import app
from app.models import CitizenReport, CitizenSighting, FoundItem, LostReport, MatchCandidate, ObjectClass, ProcessingHistory, User
from app.services.citizen_reports import cancel_report
from app.services.image_uploads import save_public_image


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    with factory() as session: yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: (yield db)
    with TestClient(app) as test_client: yield test_client
    app.dependency_overrides.clear()


def seed(db: Session) -> None:
    now = datetime(2026, 8, 10, tzinfo=UTC)
    db.add_all([
        User(id=1, email="user@example.com", password_hash=hash_password("password123"), nickname="user", role="USER", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now),
        User(id=2, email="other@example.com", password_hash=hash_password("password123"), nickname="other", role="USER", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now),
        User(id=9, email="admin@example.com", password_hash=hash_password("password123"), nickname="admin", role="ADMIN", active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now),
        ObjectClass(id=1, code="BAG", name_ko="가방", group_code="PERSONAL_ITEM", display_order=1, is_active=True, created_at=now, updated_at=now),
        ObjectClass(id=2, code="TRASH", name_ko="폐기물", group_code="WASTE", display_order=2, is_active=True, created_at=now, updated_at=now),
        ObjectClass(id=3, code="FOOTWEAR", name_ko="신발", group_code="PERSONAL_ITEM", display_order=3, is_active=True, created_at=now, updated_at=now),
        LostReport(id=10, user_id=2, object_class_id=1, color="검정", description="검정 가방", area_name="잠실", lost_from=now - timedelta(hours=1), status="OPEN", created_at=now, updated_at=now),
    ])
    db.commit()


def login(client: TestClient, email: str) -> None:
    assert client.post("/api/auth/login", json={"email": email, "password": "password123"}).status_code == 200


def create_report(client: TestClient) -> dict:
    response = client.post("/api/citizen-reports", data={"object_class": "BAG", "color": "검정", "description": "검정 가방을 발견했습니다", "area_name": "잠실", "found_at": "2026-08-10T01:00:00Z"})
    assert response.status_code == 201
    return response.json()


def image_bytes(*, width: int = 8, height: int = 8, image_format: str = "JPEG", orientation: int | None = None) -> bytes:
    payload = BytesIO()
    image = Image.new("RGB", (width, height), "red")
    if orientation is None:
        image.save(payload, format=image_format)
    else:
        exif = Image.Exif()
        exif[274] = orientation
        image.save(payload, format=image_format, exif=exif)
    return payload.getvalue()


def test_webcam_style_footwear_report_attaches_image_and_is_pending_for_admin(
    client: TestClient, db: Session, tmp_path, monkeypatch
) -> None:
    seed(db)
    login(client, "user@example.com")
    monkeypatch.setattr("app.api.citizen_reports.upload_root", lambda: tmp_path)
    image = BytesIO()
    Image.new("RGB", (8, 8), "black").save(image, format="JPEG")

    response = client.post(
        "/api/citizen-reports",
        data={
            "object_class": "FOOTWEAR",
            "color": "검정",
            "description": "웹캠에서 검정 신발을 발견했습니다",
            "area_name": "한강공원 A구역",
            "found_at": "2026-08-10T01:00:00Z",
        },
        files={"image": ("webcam-frame.jpg", image.getvalue(), "image/jpeg")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["item_category"] == "FOOTWEAR"
    assert body["status"] == "PENDING"
    assert body["image_url"] is not None
    assert db.query(CitizenReport).count() == 1
    assert (tmp_path / body["image_url"].removeprefix("/uploads/")).stat().st_size > 0

    login(client, "admin@example.com")
    admin_reports = client.get("/api/admin/citizen-reports?status=PENDING")
    assert admin_reports.status_code == 200
    assert [report["id"] for report in admin_reports.json()] == [body["id"]]


def test_citizen_orm_contract_has_explicit_source_and_one_to_many_sightings() -> None:
    assert FoundItem.__table__.c.source_type.nullable is False
    assert CitizenReport.__table__.c.linked_found_item_id.foreign_keys
    assert CitizenSighting.__table__.c.citizen_report_id.foreign_keys


def test_unauthenticated_user_cannot_create_report_or_sighting(client: TestClient, db: Session) -> None:
    seed(db)
    report_response = client.post("/api/citizen-reports", data={"object_class": "BAG", "description": "검정 가방을 발견했습니다", "area_name": "잠실", "found_at": "2026-08-10T01:00:00Z"})
    sighting_response = client.post("/api/citizen-reports/999/sightings", data={"sighted_at": "2026-08-10T02:00:00Z", "location_name": "잠실", "description": "벤치 옆에서 다시 봤습니다"})
    assert report_response.status_code == 401
    assert sighting_response.status_code == 401


def test_detail_and_mine_are_scoped_to_the_owner(client: TestClient, db: Session) -> None:
    seed(db); login(client, "user@example.com"); first = create_report(client)
    assert client.get(f"/api/citizen-reports/{first['id']}").status_code == 200
    assert [item["id"] for item in client.get("/api/citizen-reports/mine").json()] == [first["id"]]
    login(client, "other@example.com"); second = create_report(client)
    mine = client.get("/api/citizen-reports/mine").json()
    assert [item["id"] for item in mine] == [second["id"]]
    assert client.get(f"/api/citizen-reports/{first['id']}").status_code == 404
    assert client.get("/api/citizen-reports/999999").status_code == 404


def test_pending_is_private_and_under_review_is_public(client: TestClient, db: Session) -> None:
    seed(db); login(client, "user@example.com"); report = create_report(client)
    assert report["status"] == "PENDING"
    assert [item["id"] for item in client.get("/api/citizen-reports").json()] == [report["id"]]
    client.post("/api/auth/logout")
    assert client.get("/api/citizen-reports").json() == []
    assert client.get(f"/api/citizen-reports/{report['id']}").status_code == 404
    login(client, "other@example.com")
    assert client.get("/api/citizen-reports").json() == []
    login(client, "admin@example.com")
    assert client.patch(f"/api/admin/citizen-reports/{report['id']}", json={"status": "UNDER_REVIEW"}).status_code == 200
    client.post("/api/auth/logout")
    assert len(client.get("/api/citizen-reports").json()) == 1


def test_sighting_is_stored_as_one_to_many_history(client: TestClient, db: Session) -> None:
    seed(db); login(client, "user@example.com"); report = create_report(client)
    login(client, "admin@example.com"); client.patch(f"/api/admin/citizen-reports/{report['id']}", json={"status": "UNDER_REVIEW"})
    login(client, "other@example.com")
    response = client.post(f"/api/citizen-reports/{report['id']}/sightings", data={"sighted_at": "2026-08-10T02:00:00Z", "location_name": "잠실 산책로", "description": "벤치 옆에서 다시 봤습니다"})
    assert response.status_code == 201
    assert response.json()["sighting_count"] == 1
    assert db.query(CitizenSighting).filter_by(citizen_report_id=report["id"]).count() == 1
    sightings = client.get(f"/api/citizen-reports/{report['id']}/sightings")
    assert sightings.status_code == 200
    assert len(sightings.json()) == 1
    assert sightings.json()[0]["location_name"] == "잠실 산책로"
    assert client.get("/api/citizen-reports/999999/sightings").status_code == 404


def test_patch_rejects_non_personal_and_unknown_categories(client: TestClient, db: Session) -> None:
    seed(db); login(client, "user@example.com"); report = create_report(client)
    assert client.patch(f"/api/citizen-reports/{report['id']}", json={"object_class": "BAG"}).status_code == 200
    assert client.patch(f"/api/citizen-reports/{report['id']}", json={"object_class": "TRASH"}).status_code == 422
    assert client.patch(f"/api/citizen-reports/{report['id']}", json={"object_class": "UNKNOWN"}).status_code == 422


def test_failed_sighting_removes_uploaded_file(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db); login(client, "user@example.com")
    monkeypatch.setattr("app.api.citizen_reports.upload_root", lambda: tmp_path)
    image = BytesIO(); Image.new("RGB", (8, 8), "blue").save(image, format="PNG")
    response = client.post("/api/citizen-reports/999999/sightings", data={"sighted_at": "2026-08-10T02:00:00Z", "location_name": "잠실", "description": "벤치 옆에서 다시 봤습니다"}, files={"image": ("photo.png", image.getvalue(), "image/png")})
    assert response.status_code == 404
    assert list(tmp_path.rglob("*.*")) == []


def test_resolve_creates_citizen_found_item_and_reverse_match_atomically(client: TestClient, db: Session) -> None:
    seed(db); login(client, "user@example.com"); report = create_report(client)
    citizen = db.get(CitizenReport, report["id"]); citizen.image_url = "/uploads/citizen/report.png"; db.commit()
    login(client, "admin@example.com")
    response = client.post(f"/api/admin/citizen-reports/{report['id']}/resolve", json={"mode": "CREATE_FOUND_ITEM", "found_item": {"object_class": "BAG", "color": "검정", "public_description": "검정 가방", "area_name": "잠실", "found_at": "2026-08-10T01:00:00Z"}})
    assert response.status_code == 200
    found = db.query(FoundItem).one()
    assert found.source_type == "CITIZEN"
    assert response.json()["linked_found_item"]["id"] == found.id
    assert db.query(MatchCandidate).filter_by(lost_report_id=10, found_item_id=found.id).count() == 1
    assert db.query(ProcessingHistory).filter_by(entity_type="CITIZEN_REPORT", entity_id=report["id"], action_type="CITIZEN_REPORT_LINKED").count() == 1
    duplicate = client.post(f"/api/admin/citizen-reports/{report['id']}/resolve", json={"mode": "CREATE_FOUND_ITEM", "found_item": {"object_class": "BAG", "public_description": "중복", "area_name": "잠실", "found_at": "2026-08-10T01:00:00Z"}})
    assert duplicate.status_code == 409
    assert db.query(FoundItem).count() == 1
    public_list = client.get("/api/found-items").json()
    assert public_list[0]["image_url"] == "/uploads/citizen/report.png"
    assert client.get(f"/api/found-items/{found.id}").json()["image_url"] == "/uploads/citizen/report.png"
    assert client.get("/api/admin/dashboard?period=all").json()["recent_items"][0]["image_url"] == "/uploads/citizen/report.png"


def test_admin_citizen_report_access_list_detail_review_and_missing(client: TestClient, db: Session) -> None:
    seed(db); login(client, "user@example.com"); report = create_report(client)
    assert client.get("/api/admin/citizen-reports").status_code == 403
    assert client.get(f"/api/admin/citizen-reports/{report['id']}").status_code == 403

    login(client, "admin@example.com")
    listing = client.get("/api/admin/citizen-reports")
    assert listing.status_code == 200
    assert listing.json()[0]["id"] == report["id"]
    assert client.get(f"/api/admin/citizen-reports/{report['id']}").status_code == 200
    reviewed = client.patch(f"/api/admin/citizen-reports/{report['id']}", json={"status": "UNDER_REVIEW", "admin_memo": "사진과 위치 확인"})
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "UNDER_REVIEW"
    assert db.query(ProcessingHistory).filter_by(entity_type="CITIZEN_REPORT", entity_id=report["id"], action_type="CITIZEN_REPORT_REVIEWED").count() == 1
    assert client.get("/api/admin/citizen-reports?status=UNDER_REVIEW").json()[0]["id"] == report["id"]
    assert client.get("/api/admin/citizen-reports/999999").status_code == 404
    assert client.patch("/api/admin/citizen-reports/999999", json={"status": "UNDER_REVIEW"}).status_code == 404
    assert client.post("/api/admin/citizen-reports/999999/resolve", json={"mode": "LINK_EXISTING", "found_item_id": 1}).status_code == 404


def test_owner_can_delete_pending_report_and_remove_uploaded_image(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db)
    login(client, "user@example.com")
    monkeypatch.setattr("app.api.citizen_reports.upload_root", lambda: tmp_path)
    response = client.post(
        "/api/citizen-reports",
        data={"object_class": "FOOTWEAR", "color": "white", "description": "webcam frame report", "area_name": "demo booth", "found_at": "2026-08-10T01:00:00Z"},
        files={"image": ("frame.jpg", image_bytes(), "image/jpeg")},
    )
    assert response.status_code == 201
    report = response.json()
    image_path = tmp_path / report["image_url"].removeprefix("/uploads/")
    assert image_path.is_file()

    deleted = client.delete(f"/api/citizen-reports/{report['id']}")

    assert deleted.status_code == 200
    assert deleted.json()["status"] == "CANCELLED"
    stored = db.get(CitizenReport, report["id"])
    assert stored is not None
    assert stored.status == "CANCELLED"
    assert stored.image_url is None
    assert not image_path.exists()
    assert client.get("/api/citizen-reports/mine").json() == []
    assert client.get("/api/citizen-reports").json() == []
    login(client, "admin@example.com")
    assert client.get("/api/admin/citizen-reports").json() == []
    assert client.get("/api/admin/citizen-reports?status=CANCELLED").json() == []
    assert client.get(f"/api/admin/citizen-reports/{report['id']}").status_code == 404


def test_only_owner_can_delete_citizen_report(client: TestClient, db: Session) -> None:
    seed(db)
    login(client, "user@example.com")
    report = create_report(client)

    login(client, "other@example.com")
    response = client.delete(f"/api/citizen-reports/{report['id']}")

    assert response.status_code == 404
    assert db.get(CitizenReport, report["id"]).status == "PENDING"


def test_owner_can_delete_under_review_report(client: TestClient, db: Session) -> None:
    seed(db)
    login(client, "user@example.com")
    report = create_report(client)
    login(client, "admin@example.com")
    assert client.patch(f"/api/admin/citizen-reports/{report['id']}", json={"status": "UNDER_REVIEW"}).status_code == 200

    login(client, "user@example.com")
    response = client.delete(f"/api/citizen-reports/{report['id']}")

    assert response.status_code == 200
    assert db.get(CitizenReport, report["id"]).status == "CANCELLED"


def test_delete_report_removes_only_report_image_not_sighting_images(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db)
    login(client, "user@example.com")
    monkeypatch.setattr("app.api.citizen_reports.upload_root", lambda: tmp_path)
    response = client.post(
        "/api/citizen-reports",
        data={"object_class": "BAG", "color": "black", "description": "report image cleanup", "area_name": "demo", "found_at": "2026-08-10T01:00:00Z"},
        files={"image": ("report.jpg", image_bytes(), "image/jpeg")},
    )
    assert response.status_code == 201
    report = response.json()
    report_image = tmp_path / report["image_url"].removeprefix("/uploads/")
    sighting_image = tmp_path / "citizen" / "sighting.jpg"
    sighting_image.parent.mkdir(parents=True, exist_ok=True)
    sighting_image.write_bytes(b"sighting")
    stored = db.get(CitizenReport, report["id"])
    stored.status = "UNDER_REVIEW"
    db.add(CitizenSighting(citizen_report_id=stored.id, user_id=2, sighted_at=datetime(2026, 8, 10, tzinfo=UTC), location_name="demo", description="sighting", image_url="/uploads/citizen/sighting.jpg", created_at=datetime(2026, 8, 10, tzinfo=UTC)))
    db.commit()

    deleted = client.delete(f"/api/citizen-reports/{report['id']}")

    assert deleted.status_code == 200
    assert not report_image.exists()
    assert sighting_image.exists()


def test_linked_report_delete_returns_conflict_and_preserves_found_item(client: TestClient, db: Session) -> None:
    seed(db)
    login(client, "user@example.com")
    report = create_report(client)
    citizen = db.get(CitizenReport, report["id"])
    citizen.image_url = "/uploads/citizen/linked.jpg"
    db.commit()
    login(client, "admin@example.com")
    assert client.post(
        f"/api/admin/citizen-reports/{report['id']}/resolve",
        json={"mode": "CREATE_FOUND_ITEM", "found_item": {"object_class": "BAG", "public_description": "linked item", "area_name": "demo", "found_at": "2026-08-10T01:00:00Z"}},
    ).status_code == 200
    found_item_id = db.query(FoundItem).one().id

    login(client, "user@example.com")
    response = client.delete(f"/api/citizen-reports/{report['id']}")

    assert response.status_code == 409
    stored = db.get(CitizenReport, report["id"])
    assert stored.status == "LINKED"
    assert stored.image_url == "/uploads/citizen/linked.jpg"
    assert stored.linked_found_item_id == found_item_id
    assert db.get(FoundItem, found_item_id) is not None


def test_duplicate_delete_returns_conflict(client: TestClient, db: Session) -> None:
    seed(db)
    login(client, "user@example.com")
    report = create_report(client)

    assert client.delete(f"/api/citizen-reports/{report['id']}").status_code == 200
    assert client.delete(f"/api/citizen-reports/{report['id']}").status_code == 409


def test_delete_db_failure_does_not_remove_image(db: Session, tmp_path, monkeypatch) -> None:
    seed(db)
    user = db.get(User, 1)
    image_path = tmp_path / "citizen" / "rollback.jpg"
    image_path.parent.mkdir(parents=True)
    image_path.write_bytes(b"image")
    report = CitizenReport(
        user_id=user.id,
        object_class_id=1,
        color="white",
        description="rollback report",
        image_url="/uploads/citizen/rollback.jpg",
        area_name="demo",
        found_at=datetime(2026, 8, 10, tzinfo=UTC),
        status="PENDING",
        created_at=datetime(2026, 8, 10, tzinfo=UTC),
        updated_at=datetime(2026, 8, 10, tzinfo=UTC),
    )
    db.add(report)
    db.commit()

    def fail_commit() -> None:
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError):
        cancel_report(db, user=user, report_id=report.id, upload_root=tmp_path)

    assert image_path.exists()
    db.rollback()


def test_image_upload_decodes_reencodes_and_rejects_non_images(tmp_path) -> None:
    image_bytes = BytesIO(); Image.new("RGB", (8, 8), "red").save(image_bytes, format="JPEG", exif=b"Exif\x00\x00test")
    saved = asyncio.run(save_public_image(UploadFile(filename="photo.jpg", file=BytesIO(image_bytes.getvalue())), tmp_path))
    assert saved and saved.endswith(".jpg")
    with Image.open(tmp_path / saved.removeprefix("/uploads/")) as stored:
        assert stored.size == (8, 8)
        assert not stored.getexif()
    with pytest.raises(Exception): asyncio.run(save_public_image(UploadFile(filename="fake.jpg", file=BytesIO(b"not-image")), tmp_path))


@pytest.mark.parametrize("orientation", [6, 8])
def test_image_upload_applies_exif_orientation_and_removes_metadata(tmp_path, orientation: int) -> None:
    saved = asyncio.run(
        save_public_image(
            UploadFile(filename="photo.jpg", file=BytesIO(image_bytes(width=40, height=20, orientation=orientation))),
            tmp_path,
        )
    )

    assert saved and saved.endswith(".jpg")
    with Image.open(tmp_path / saved.removeprefix("/uploads/")) as stored:
        assert stored.size == (20, 40)
        assert not stored.getexif()
        assert stored.getexif().get(274) is None


def test_image_upload_supabase_path_uses_same_exif_normalized_payload(tmp_path, monkeypatch) -> None:
    captured: dict[str, bytes | str] = {}

    async def fake_upload(object_key: str, payload: bytes, content_type: str) -> str:
        captured["object_key"] = object_key
        captured["payload"] = payload
        captured["content_type"] = content_type
        return f"https://storage.example/{object_key}"

    monkeypatch.setattr("app.services.image_uploads._supabase_configured", lambda: True)
    monkeypatch.setattr("app.services.image_uploads._upload_to_supabase", fake_upload)

    saved = asyncio.run(
        save_public_image(
            UploadFile(filename="photo.jpg", file=BytesIO(image_bytes(width=40, height=20, orientation=6))),
            tmp_path,
        )
    )

    assert saved == f"https://storage.example/{captured['object_key']}"
    assert captured["content_type"] == "image/jpeg"
    payload = captured["payload"]
    assert isinstance(payload, bytes)
    with Image.open(BytesIO(payload)) as stored:
        assert stored.size == (20, 40)
        assert not stored.getexif()


def test_lost_report_image_upload_is_optional_validated_and_persisted(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db); login(client, "user@example.com")
    monkeypatch.setattr("app.api.lost_reports.upload_root", lambda: tmp_path)
    fields = {"item_category": "BAG", "color": "검정", "colors": ["검정", "파랑"], "description": "검정 가방", "lost_location": "잠실", "lost_at": "2026-08-09T01:00:00Z"}

    without_image = client.post("/api/lost-reports", data=fields)
    assert without_image.status_code == 201
    assert without_image.json()["image_url"] is None
    assert without_image.json()["colors"] == ["검정", "파랑"]
    assert db.get(LostReport, without_image.json()["id"]).colors == ["검정", "파랑"]

    image_bytes = BytesIO(); Image.new("RGB", (8, 8), "blue").save(image_bytes, format="PNG")
    with_image = client.post("/api/lost-reports", data=fields, files={"image": ("bag.png", image_bytes.getvalue(), "image/png")})
    assert with_image.status_code == 201
    image_url = with_image.json()["image_url"]
    assert image_url.startswith("/uploads/lost-reports/")
    assert db.get(LostReport, with_image.json()["id"]).image_url == image_url
    assert (tmp_path / image_url.removeprefix("/uploads/")).is_file()

    before = db.query(LostReport).count()
    invalid = client.post("/api/lost-reports", data=fields, files={"image": ("fake.jpg", b"not-image", "image/jpeg")})
    assert invalid.status_code == 415
    assert db.query(LostReport).count() == before

    mine = client.get("/api/lost-reports/me")
    detail = client.get(f"/api/lost-reports/{with_image.json()['id']}")
    assert mine.status_code == 200
    assert next(item for item in mine.json() if item["id"] == with_image.json()["id"])["image_url"] == image_url
    assert detail.status_code == 200
    assert detail.json()["image_url"] == image_url
    assert detail.json()["colors"] == ["검정", "파랑"]


def test_lost_report_preserves_optional_coordinates_and_validates_the_pair(client: TestClient, db: Session) -> None:
    seed(db); login(client, "user@example.com")
    fields = {"item_category": "BAG", "color": "검정", "colors": ["검정", "파랑"], "description": "검정 가방", "lost_location": "잠실역", "lost_at": "2026-08-09T01:00:00Z"}

    mapped = client.post("/api/lost-reports", data={**fields, "latitude": "37.5133", "longitude": "127.1001"})
    assert mapped.status_code == 201
    assert mapped.json()["latitude"] == pytest.approx(37.5133)
    assert mapped.json()["longitude"] == pytest.approx(127.1001)
    stored = db.get(LostReport, mapped.json()["id"])
    assert float(stored.latitude) == pytest.approx(37.5133)
    assert float(stored.longitude) == pytest.approx(127.1001)

    direct = client.post("/api/lost-reports", data={**fields, "lost_location": "잠실 근처 골목"})
    assert direct.status_code == 201
    assert direct.json()["latitude"] is None
    assert direct.json()["longitude"] is None
    assert direct.json()["colors"] == ["검정", "파랑"]

    assert client.post("/api/lost-reports", data={**fields, "latitude": "37.5"}).status_code == 422
    assert client.post("/api/lost-reports", data={**fields, "longitude": "127.1"}).status_code == 422
    assert client.post("/api/lost-reports", data={**fields, "latitude": "91", "longitude": "127.1"}).status_code == 422
    assert client.post("/api/lost-reports", data={**fields, "latitude": "37.5", "longitude": "181"}).status_code == 422


@pytest.mark.parametrize(("image_format", "filename", "content_type", "suffix"), [
    ("JPEG", "item.jpg", "image/jpeg", ".jpg"),
    ("PNG", "item.png", "image/png", ".png"),
    ("WEBP", "item.webp", "image/webp", ".webp"),
])
def test_lost_report_accepts_supported_decoded_images(client: TestClient, db: Session, tmp_path, monkeypatch, image_format: str, filename: str, content_type: str, suffix: str) -> None:
    seed(db); login(client, "user@example.com")
    monkeypatch.setattr("app.api.lost_reports.upload_root", lambda: tmp_path)
    payload = BytesIO(); Image.new("RGB", (8, 8), "blue").save(payload, format=image_format)
    response = client.post("/api/lost-reports", data={"item_category": "BAG", "description": "사진 형식 검사", "lost_location": "잠실", "lost_at": "2026-08-09T01:00:00Z"}, files={"image": (filename, payload.getvalue(), content_type)})
    assert response.status_code == 201
    assert response.json()["image_url"].endswith(suffix)


def test_lost_report_rejects_oversized_unsupported_and_unauthenticated_uploads(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db)
    monkeypatch.setattr("app.api.lost_reports.upload_root", lambda: tmp_path)
    fields = {"item_category": "BAG", "description": "업로드 거부 검사", "lost_location": "잠실", "lost_at": "2026-08-09T01:00:00Z"}
    image = BytesIO(); Image.new("RGB", (8, 8), "red").save(image, format="PNG")
    assert client.post("/api/lost-reports", data=fields, files={"image": ("item.png", image.getvalue(), "image/png")}).status_code == 401
    login(client, "user@example.com")
    assert client.post("/api/lost-reports", data=fields, files={"image": ("large.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")}).status_code == 413
    gif = BytesIO(); Image.new("RGB", (8, 8), "red").save(gif, format="GIF")
    assert client.post("/api/lost-reports", data=fields, files={"image": ("item.gif", gif.getvalue(), "image/gif")}).status_code == 415
    assert client.post("/api/lost-reports", data=fields, files={"image": ("pretend.png", b"not-an-image", "image/png")}).status_code == 415


def test_public_image_rejects_unsafe_image_types_and_large_dimensions(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("app.services.image_uploads.MAX_IMAGE_PIXELS", 4)

    with pytest.raises(HTTPException) as heic:
        asyncio.run(
            save_public_image(
                UploadFile(filename="photo.heic", file=BytesIO(b"not-heic"), headers={"content-type": "image/heic"}),
                tmp_path,
            )
        )
    assert heic.value.status_code == 415

    animated = BytesIO()
    Image.new("RGB", (1, 1), "red").save(
        animated,
        format="WEBP",
        save_all=True,
        append_images=[Image.new("RGB", (1, 1), "blue")],
    )
    with pytest.raises(HTTPException) as webp:
        asyncio.run(
            save_public_image(
                UploadFile(filename="animated.webp", file=BytesIO(animated.getvalue()), headers={"content-type": "image/webp"}),
                tmp_path,
            )
        )
    assert webp.value.status_code == 415

    with pytest.raises(HTTPException) as huge:
        asyncio.run(
            save_public_image(
                UploadFile(filename="huge.jpg", file=BytesIO(image_bytes(width=3, height=3)), headers={"content-type": "image/jpeg"}),
                tmp_path,
            )
        )
    assert huge.value.status_code == 413
    assert not list(tmp_path.glob("**/*"))


def test_lost_report_db_failure_removes_uploaded_file(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db); login(client, "user@example.com")
    monkeypatch.setattr("app.api.lost_reports.upload_root", lambda: tmp_path)
    monkeypatch.setattr("app.api.lost_reports.create_lost_report_for_user", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("database failure")))
    image = BytesIO(); Image.new("RGB", (8, 8), "red").save(image, format="PNG")
    with pytest.raises(RuntimeError):
        client.post("/api/lost-reports", data={"item_category": "BAG", "description": "cleanup", "lost_location": "잠실", "lost_at": "2026-08-09T01:00:00Z"}, files={"image": ("item.png", image.getvalue(), "image/png")})
    assert not list((tmp_path / "lost-reports").glob("*"))
