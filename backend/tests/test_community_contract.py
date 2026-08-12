from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.auth import get_current_user
from app.core.security import utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import User


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


def user(db: Session, user_id: int, role: str = "USER") -> User:
    now = utc_now(); item = User(id=user_id, email=f"community{user_id}@example.com", password_hash="unused", nickname=f"작성자{user_id}", role=role, active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now); db.add(item); db.commit(); return item


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: (yield db)
    with TestClient(app) as value: yield value
    app.dependency_overrides.clear()


def as_user(current: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: current


def post(client: TestClient, **values):
    payload = {"category": "FIELD_STORY", "title": "한강 산책로 이야기", "content": "오후에 물이 많이 올라왔어요.", **values}
    return client.post("/api/community/posts", data=payload)


def test_create_list_detail_and_optional_location(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    created = post(client)
    assert created.status_code == 201 and created.json()["place_name"] is None
    listing = client.get("/api/community/posts")
    assert listing.status_code == 200 and listing.json()["posts"][0]["title"] == "한강 산책로 이야기"
    assert client.get(f"/api/community/posts/{created.json()['id']}").status_code == 200


def test_opinion_post_allows_optional_location_and_feed_filter(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    created = post(client, category="OPINION", title="자유 이야기", content="위치 없이 나누는 의견입니다.")
    assert created.status_code == 201
    payload = created.json()
    assert payload["category"] == "OPINION"
    assert payload["place_name"] is None
    assert payload["latitude"] is None
    assert payload["longitude"] is None

    listing = client.get("/api/community/posts", params={"category": "OPINION"})
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()["posts"]] == [payload["id"]]


def test_opinion_post_with_coordinates_is_available_for_map_clients(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    without_location = post(client, category="OPINION", title="위치 없는 의견", content="지도에는 표시하지 않을 글입니다.").json()
    with_location = post(
        client,
        category="OPINION",
        title="좌표 있는 의견",
        content="지도에 표시할 수 있는 글입니다.",
        place_name="서울 한강공원",
        latitude="37.5200",
        longitude="126.9400",
    ).json()

    listing = client.get("/api/community/posts", params={"category": "OPINION"})
    assert listing.status_code == 200
    posts = {item["id"]: item for item in listing.json()["posts"]}
    assert posts[without_location["id"]]["latitude"] is None
    assert posts[with_location["id"]]["latitude"] == pytest.approx(37.52)
    assert posts[with_location["id"]]["longitude"] == pytest.approx(126.94)


def test_update_comment_and_soft_delete_opinion_post(client: TestClient, db: Session) -> None:
    owner = user(db, 1)
    as_user(owner)
    created = post(client, title="기존 이야기", content="수정 전입니다.").json()
    post_id = created["id"]

    updated = client.patch(
        f"/api/community/posts/{post_id}",
        data={"category": "OPINION", "title": "자유 이야기로 수정", "content": "수정 후 의견입니다."},
    )
    assert updated.status_code == 200
    assert updated.json()["category"] == "OPINION"

    comment = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "의견에 댓글을 남깁니다."})
    assert comment.status_code == 201

    assert client.delete(f"/api/community/posts/{post_id}").status_code == 204
    assert client.get(f"/api/community/posts/{post_id}").status_code == 404
    listing = client.get("/api/community/posts", params={"category": "OPINION"})
    assert post_id not in [item["id"] for item in listing.json()["posts"]]


def test_comment_reply_contract(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    post_id = post(client).json()["id"]
    root = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "원 댓글입니다."})
    assert root.status_code == 201
    assert root.json()["parent_comment_id"] is None

    reply = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "답글입니다.", "parent_comment_id": str(root.json()["id"])})
    assert reply.status_code == 201
    assert reply.json()["parent_comment_id"] == root.json()["id"]

    nested = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "대댓글의 대댓글입니다.", "parent_comment_id": str(reply.json()["id"])})
    assert nested.status_code == 422

    comments = client.get(f"/api/community/posts/{post_id}/comments")
    assert comments.status_code == 200
    assert [item["parent_comment_id"] for item in comments.json()] == [None, root.json()["id"]]


def test_create_and_update_coordinate_contract(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    created = post(client, place_name="서울시청", latitude="37.5665", longitude="126.9780")
    assert created.status_code == 201
    assert created.json()["latitude"] == pytest.approx(37.5665)
    assert created.json()["longitude"] == pytest.approx(126.9780)

    post_id = created.json()["id"]
    update = client.patch(f"/api/community/posts/{post_id}", data={"category": "FIELD_STORY", "title": "경계 좌표", "content": "경계값도 정상적으로 저장됩니다.", "latitude": "-90", "longitude": "180"})
    assert update.status_code == 200
    assert update.json()["latitude"] == pytest.approx(-90)
    assert update.json()["longitude"] == pytest.approx(180)

    without_coordinates = post(client, title="직접 입력", content="좌표가 없어도 작성할 수 있습니다.")
    assert without_coordinates.status_code == 201
    assert without_coordinates.json()["latitude"] is None
    assert without_coordinates.json()["longitude"] is None


@pytest.mark.parametrize(("coordinates", "expected"), [
    ({"latitude": "37.5"}, 422),
    ({"longitude": "127.0"}, 422),
    ({"latitude": "91", "longitude": "127"}, 422),
    ({"latitude": "-91", "longitude": "127"}, 422),
    ({"latitude": "37", "longitude": "181"}, 422),
    ({"latitude": "37", "longitude": "-181"}, 422),
    ({"latitude": "90", "longitude": "-180"}, 201),
    ({"latitude": "-90", "longitude": "180"}, 201),
])
def test_create_coordinate_bounds(client: TestClient, db: Session, coordinates: dict[str, str], expected: int) -> None:
    as_user(user(db, 1))
    assert post(client, **coordinates).status_code == expected


@pytest.mark.parametrize("coordinates", [
    {"latitude": "37.5"},
    {"longitude": "127.0"},
    {"latitude": "91", "longitude": "127"},
    {"latitude": "-91", "longitude": "127"},
    {"latitude": "37", "longitude": "181"},
    {"latitude": "37", "longitude": "-181"},
])
def test_update_rejects_partial_and_out_of_range_coordinates(client: TestClient, db: Session, coordinates: dict[str, str]) -> None:
    as_user(user(db, 1))
    post_id = post(client).json()["id"]
    response = client.patch(f"/api/community/posts/{post_id}", data={"category": "FIELD_STORY", "title": "수정 좌표", "content": "잘못된 좌표는 저장하지 않습니다.", **coordinates})
    assert response.status_code == 422


def test_user_cannot_create_notice_but_admin_can(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    assert post(client, is_notice="true").status_code == 403
    as_user(user(db, 2, "ADMIN"))
    response = post(client, is_notice="true")
    assert response.status_code == 201 and response.json()["is_notice"] is True


def test_post_and_comment_owner_permissions(client: TestClient, db: Session) -> None:
    owner = user(db, 1); other = user(db, 2); admin = user(db, 3, "ADMIN")
    as_user(owner); created = post(client).json(); post_id = created["id"]
    comment = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "좋은 정보 감사합니다."})
    assert comment.status_code == 201
    as_user(other)
    assert client.patch(f"/api/community/posts/{post_id}", data={"category": "QUESTION", "title": "수정 시도", "content": "수정할 수 없어야 합니다."}).status_code == 403
    assert client.delete(f"/api/community/comments/{comment.json()['id']}").status_code == 403
    as_user(admin)
    assert client.delete(f"/api/community/comments/{comment.json()['id']}").status_code == 204
    assert client.delete(f"/api/community/posts/{post_id}").status_code == 204
    assert client.get(f"/api/community/posts/{post_id}").status_code == 404
