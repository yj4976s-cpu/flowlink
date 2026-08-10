import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password
from app.db.session import Base, get_db
from app.main import app
from app.models import CitizenReport, CitizenSighting, FoundItem, LostReport, MatchCandidate, ObjectClass, ProcessingHistory, User
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
        LostReport(id=10, user_id=2, object_class_id=1, color="검정", description="검정 가방", area_name="잠실", lost_from=now - timedelta(hours=1), status="OPEN", created_at=now, updated_at=now),
    ])
    db.commit()


def login(client: TestClient, email: str) -> None:
    assert client.post("/api/auth/login", json={"email": email, "password": "password123"}).status_code == 200


def create_report(client: TestClient) -> dict:
    response = client.post("/api/citizen-reports", data={"object_class": "BAG", "color": "검정", "description": "검정 가방을 발견했습니다", "area_name": "잠실", "found_at": "2026-08-10T01:00:00Z"})
    assert response.status_code == 201
    return response.json()


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


def test_image_upload_decodes_reencodes_and_rejects_non_images(tmp_path) -> None:
    image_bytes = BytesIO(); Image.new("RGB", (8, 8), "red").save(image_bytes, format="JPEG", exif=b"Exif\x00\x00test")
    saved = asyncio.run(save_public_image(UploadFile(filename="photo.jpg", file=BytesIO(image_bytes.getvalue())), tmp_path))
    assert saved and saved.endswith(".jpg")
    with Image.open(tmp_path / saved.removeprefix("/uploads/")) as stored: assert not stored.getexif()
    with pytest.raises(Exception): asyncio.run(save_public_image(UploadFile(filename="fake.jpg", file=BytesIO(b"not-image")), tmp_path))


def test_lost_report_image_upload_is_optional_validated_and_persisted(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db); login(client, "user@example.com")
    monkeypatch.setattr("app.api.lost_reports.upload_root", lambda: tmp_path)
    fields = {"item_category": "BAG", "color": "검정", "description": "검정 가방", "lost_location": "잠실", "lost_at": "2026-08-09T01:00:00Z"}

    without_image = client.post("/api/lost-reports", data=fields)
    assert without_image.status_code == 201
    assert without_image.json()["image_url"] is None

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


def test_lost_report_db_failure_removes_uploaded_file(client: TestClient, db: Session, tmp_path, monkeypatch) -> None:
    seed(db); login(client, "user@example.com")
    monkeypatch.setattr("app.api.lost_reports.upload_root", lambda: tmp_path)
    monkeypatch.setattr("app.api.lost_reports.create_lost_report_for_user", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("database failure")))
    image = BytesIO(); Image.new("RGB", (8, 8), "red").save(image, format="PNG")
    with pytest.raises(RuntimeError):
        client.post("/api/lost-reports", data={"item_category": "BAG", "description": "cleanup", "lost_location": "잠실", "lost_at": "2026-08-09T01:00:00Z"}, files={"image": ("item.png", image.getvalue(), "image/png")})
    assert not list((tmp_path / "lost-reports").glob("*"))
