from collections.abc import Iterator
from datetime import timedelta

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
from app.models import CitizenReport, FoundItem, ObjectClass, User


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


def object_class(db: Session, class_id: int = 1, name_ko: str | None = None) -> ObjectClass:
    now = utc_now()
    item = ObjectClass(
        id=class_id,
        code=f"TEST_{class_id}",
        name_ko=name_ko or f"테스트 물품 {class_id}",
        group_code="TEST",
        display_order=class_id,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    return item


def found_item(
    db: Session,
    object_class_item: ObjectClass,
    *,
    status: str = "AVAILABLE",
    is_public: bool = True,
    area_name: str = "서울역",
    color: str | None = None,
    public_description: str | None = "커뮤니티 테스트 발견물",
    created_offset_minutes: int = 0,
    image_url: str | None = None,
) -> FoundItem:
    now = utc_now() + timedelta(minutes=created_offset_minutes)
    item = FoundItem(
        object_class_id=object_class_item.id,
        source_type="CITIZEN" if image_url else "ADMIN",
        color=color,
        public_description=public_description,
        private_features=None,
        area_name=area_name,
        latitude=None,
        longitude=None,
        found_at=now,
        status=status,
        storage_location=None,
        admin_memo=None,
        is_public=is_public,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    if image_url:
        reporter = user(db, 9000 + item.id)
        report = CitizenReport(
            user_id=reporter.id,
            object_class_id=object_class_item.id,
            color=None,
            description="커뮤니티 테스트 제보",
            image_url=image_url,
            area_name=area_name,
            latitude=None,
            longitude=None,
            found_at=now,
            status="LINKED",
            linked_found_item_id=item.id,
            linked_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(report)
        db.commit()
        db.refresh(item)
    return item


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


def test_delete_root_comment_soft_deletes_one_level_replies(client: TestClient, db: Session) -> None:
    owner = user(db, 1)
    replier = user(db, 2)
    as_user(owner)
    post_id = post(client).json()["id"]
    root = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "root comment"}).json()

    as_user(replier)
    reply = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "reply comment", "parent_comment_id": str(root["id"])})
    assert reply.status_code == 201

    comments = client.get(f"/api/community/posts/{post_id}/comments")
    assert comments.status_code == 200
    assert len(comments.json()) == 2

    as_user(owner)
    assert client.delete(f"/api/community/comments/{root['id']}").status_code == 204
    comments = client.get(f"/api/community/posts/{post_id}/comments")
    assert comments.status_code == 200
    assert comments.json() == []
    detail = client.get(f"/api/community/posts/{post_id}")
    assert detail.status_code == 200
    assert detail.json()["comment_count"] == 0


def test_delete_reply_keeps_root_comment(client: TestClient, db: Session) -> None:
    owner = user(db, 1)
    replier = user(db, 2)
    as_user(owner)
    post_id = post(client).json()["id"]
    root = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "root comment"}).json()

    as_user(replier)
    reply = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "reply comment", "parent_comment_id": str(root["id"])}).json()
    assert client.delete(f"/api/community/comments/{reply['id']}").status_code == 204

    comments = client.get(f"/api/community/posts/{post_id}/comments")
    assert comments.status_code == 200
    assert [(item["id"], item["parent_comment_id"]) for item in comments.json()] == [(root["id"], None)]
    detail = client.get(f"/api/community/posts/{post_id}")
    assert detail.status_code == 200
    assert detail.json()["comment_count"] == 1


def test_comment_delete_permission_regression_for_root_and_reply(client: TestClient, db: Session) -> None:
    owner = user(db, 1)
    replier = user(db, 2)
    other = user(db, 3)
    admin = user(db, 4, "ADMIN")
    as_user(owner)
    post_id = post(client).json()["id"]
    root = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "root comment"}).json()
    as_user(replier)
    reply = client.post(f"/api/community/posts/{post_id}/comments", data={"content": "reply comment", "parent_comment_id": str(root["id"])}).json()

    as_user(other)
    assert client.delete(f"/api/community/comments/{root['id']}").status_code == 403
    assert client.delete(f"/api/community/comments/{reply['id']}").status_code == 403

    as_user(admin)
    assert client.delete(f"/api/community/comments/{root['id']}").status_code == 204
    assert client.get(f"/api/community/posts/{post_id}/comments").json() == []


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


def test_feed_total_counts_regular_posts_only(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    for index in range(3):
        assert post(client, title=f"일반 글 {index}").status_code == 201
    as_user(user(db, 2, "ADMIN"))
    assert post(client, title="공지 글", is_notice="true").status_code == 201

    response = client.get("/api/community/posts", params={"limit": 10})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert payload["has_more"] is False
    assert len(payload["notices"]) == 1
    assert all(not item["is_notice"] for item in payload["posts"])


def test_feed_total_uses_category_query_and_place_filters(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    assert post(client, category="OPINION", title="노란 우산 이야기", place_name="서울역").status_code == 201
    assert post(client, category="OPINION", title="검정 지갑 이야기", place_name="부산역").status_code == 201
    assert post(client, category="QUESTION", title="노란 우산 도움 요청", place_name="서울역").status_code == 201

    category = client.get("/api/community/posts", params={"category": "OPINION", "limit": 10}).json()
    query = client.get("/api/community/posts", params={"query": "노란", "limit": 10}).json()
    place = client.get("/api/community/posts", params={"place": "서울", "limit": 10}).json()
    combined = client.get("/api/community/posts", params={"category": "OPINION", "query": "노란", "place": "서울", "limit": 10}).json()

    assert category["total"] == 2
    assert query["total"] == 2
    assert place["total"] == 2
    assert combined["total"] == 1


def test_feed_numbered_pagination_boundaries(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    for index in range(21):
        assert post(client, title=f"페이지 글 {index:02d}").status_code == 201

    page1 = client.get("/api/community/posts", params={"skip": 0, "limit": 10}).json()
    page2 = client.get("/api/community/posts", params={"skip": 10, "limit": 10}).json()
    page3 = client.get("/api/community/posts", params={"skip": 20, "limit": 10}).json()

    assert page1["total"] == 21
    assert len(page1["posts"]) == 10
    assert page1["has_more"] is True
    assert len(page2["posts"]) == 10
    assert page2["has_more"] is True
    assert len(page3["posts"]) == 1
    assert page3["has_more"] is False


def test_feed_paginates_mixed_posts_and_system_updates_without_duplicates(client: TestClient, db: Session) -> None:
    item_class = object_class(db)
    as_user(user(db, 1))
    for index in range(2):
        assert post(client, title=f"mixed post {index:02d}").status_code == 201
    for index in range(30):
        found_item(db, item_class, created_offset_minutes=index + 1)

    pages = [
        client.get("/api/community/posts", params={"skip": skip, "limit": 10}).json()
        for skip in (0, 10, 20, 30)
    ]

    assert [page["total"] for page in pages] == [32, 32, 32, 32]
    assert [len(page["posts"]) + len(page["system_updates"]) for page in pages] == [10, 10, 10, 2]
    assert [page["has_more"] for page in pages] == [True, True, True, False]

    seen: set[tuple[str, int]] = set()
    previous_page_oldest: str | None = None
    for page in pages:
        timestamps = [item["created_at"] for item in page["posts"]] + [item["timestamp"] for item in page["system_updates"]]
        ordered_timestamps = sorted(timestamps, reverse=True)
        if previous_page_oldest is not None and ordered_timestamps:
            assert previous_page_oldest >= ordered_timestamps[0]
        if ordered_timestamps:
            previous_page_oldest = ordered_timestamps[-1]
        keys = [("post", item["id"]) for item in page["posts"]] + [(item["type"], item["id"]) for item in page["system_updates"]]
        assert seen.isdisjoint(keys)
        seen.update(keys)
    assert len(seen) == 32


def test_feed_system_updates_include_representative_image_or_null(client: TestClient, db: Session) -> None:
    item_class = object_class(db)
    with_image = found_item(db, item_class, image_url="/uploads/citizen/test.jpg", created_offset_minutes=2)
    without_image = found_item(db, item_class, created_offset_minutes=1)

    payload = client.get("/api/community/posts", params={"limit": 10}).json()
    updates = {item["id"]: item for item in payload["system_updates"]}

    assert updates[with_image.id]["image_url"] == "/uploads/citizen/test.jpg"
    assert updates[without_image.id]["image_url"] is None


def test_feed_place_filter_applies_to_posts_and_public_system_updates(client: TestClient, db: Session) -> None:
    item_class = object_class(db)
    as_user(user(db, 1))
    assert post(client, title="seoul post", place_name="서울역").status_code == 201
    assert post(client, title="busan post", place_name="부산역").status_code == 201
    seoul_item = found_item(db, item_class, area_name="서울역", created_offset_minutes=2)
    found_item(db, item_class, area_name="서울역", is_public=False, created_offset_minutes=3)
    found_item(db, item_class, area_name="부산역", created_offset_minutes=4)

    payload = client.get("/api/community/posts", params={"place": "서울", "limit": 10}).json()

    assert payload["total"] == 2
    assert [item["title"] for item in payload["posts"]] == ["seoul post"]
    assert [item["id"] for item in payload["system_updates"]] == [seoul_item.id]
    assert payload["system_updates"][0]["place_name"] == "서울역"


def test_feed_category_filter_returns_only_matching_posts(client: TestClient, db: Session) -> None:
    item_class = object_class(db)
    as_user(user(db, 1))
    assert post(client, category="OPINION", title="opinion post").status_code == 201
    assert post(client, category="QUESTION", title="question post").status_code == 201
    found_item(db, item_class, created_offset_minutes=1)

    payload = client.get("/api/community/posts", params={"category": "OPINION", "limit": 10}).json()

    assert payload["total"] == 1
    assert [item["title"] for item in payload["posts"]] == ["opinion post"]
    assert payload["system_updates"] == []


def test_feed_comments_sort_orders_posts_by_visible_comment_count(client: TestClient, db: Session) -> None:
    item_class = object_class(db)
    as_user(user(db, 1))
    zero = post(client, title="comments zero").json()
    two = post(client, title="comments two").json()
    one = post(client, title="comments one").json()
    found_item(db, item_class, created_offset_minutes=10)

    for index in range(2):
        assert client.post(f"/api/community/posts/{two['id']}/comments", data={"content": f"two {index}"}).status_code == 201
    assert client.post(f"/api/community/posts/{one['id']}/comments", data={"content": "one"}).status_code == 201

    payload = client.get("/api/community/posts", params={"sort": "comments", "limit": 10}).json()

    assert [item["title"] for item in payload["posts"]] == ["comments two", "comments one", "comments zero"]
    assert [item["comment_count"] for item in payload["posts"]] == [2, 1, 0]
    assert len(payload["system_updates"]) == 1
    assert payload["total"] == 4


def test_feed_comments_sort_paginates_before_system_updates(client: TestClient, db: Session) -> None:
    item_class = object_class(db)
    as_user(user(db, 1))
    created_posts = []
    for count in range(12):
        created = post(client, title=f"comment boundary {count:02d}").json()
        created_posts.append(created)
        for index in range(count):
            assert client.post(f"/api/community/posts/{created['id']}/comments", data={"content": f"comment {count}-{index}"}).status_code == 201
    found_item(db, item_class, created_offset_minutes=30)

    page1 = client.get("/api/community/posts", params={"sort": "comments", "skip": 0, "limit": 10}).json()
    page2 = client.get("/api/community/posts", params={"sort": "comments", "skip": 10, "limit": 10}).json()

    assert page1["total"] == 13
    assert [item["comment_count"] for item in page1["posts"]] == list(range(11, 1, -1))
    assert page1["system_updates"] == []
    assert [item["comment_count"] for item in page2["posts"]] == [1, 0]
    assert len(page2["system_updates"]) == 1
    assert page2["has_more"] is False


def test_feed_query_filters_system_updates_by_object_class(client: TestClient, db: Session) -> None:
    ball_class = object_class(db, 1, "공")
    shoe_class = object_class(db, 2, "신발")
    ball = found_item(db, ball_class, area_name="서울역", created_offset_minutes=2)
    found_item(db, shoe_class, area_name="서울역", created_offset_minutes=3)

    payload = client.get("/api/community/posts", params={"query": "공", "limit": 10}).json()

    assert payload["total"] == 1
    assert payload["posts"] == []
    assert [item["id"] for item in payload["system_updates"]] == [ball.id]


def test_feed_query_filters_system_updates_by_area_and_excludes_unrelated(client: TestClient, db: Session) -> None:
    ball_class = object_class(db, 1, "공")
    bag_class = object_class(db, 2, "가방")
    as_user(user(db, 1))
    assert post(client, title="서울 목격담", place_name="서울역").status_code == 201
    seoul_item = found_item(db, ball_class, area_name="서울역", created_offset_minutes=2)
    found_item(db, bag_class, area_name="부산역", created_offset_minutes=3)

    payload = client.get("/api/community/posts", params={"query": "서울", "limit": 10}).json()

    assert payload["total"] == 2
    assert [item["title"] for item in payload["posts"]] == ["서울 목격담"]
    assert [item["id"] for item in payload["system_updates"]] == [seoul_item.id]


def test_feed_query_filters_system_updates_by_description_and_color(client: TestClient, db: Session) -> None:
    ball_class = object_class(db, 1, "공")
    matching_color = found_item(db, ball_class, color="노랑", public_description="체육관 앞", created_offset_minutes=3)
    matching_description = found_item(db, ball_class, color="파랑", public_description="특별한 별무늬", created_offset_minutes=2)
    found_item(db, ball_class, color="검정", public_description="평범한 물품", created_offset_minutes=1)

    color_payload = client.get("/api/community/posts", params={"query": "노랑", "limit": 10}).json()
    description_payload = client.get("/api/community/posts", params={"query": "별무늬", "limit": 10}).json()

    assert color_payload["total"] == 1
    assert [item["id"] for item in color_payload["system_updates"]] == [matching_color.id]
    assert description_payload["total"] == 1
    assert [item["id"] for item in description_payload["system_updates"]] == [matching_description.id]


def test_feed_total_excludes_deleted_posts(client: TestClient, db: Session) -> None:
    owner = user(db, 1)
    as_user(owner)
    kept = post(client, title="남는 글").json()
    deleted = post(client, title="삭제될 글").json()
    assert client.delete(f"/api/community/posts/{deleted['id']}").status_code == 204

    response = client.get("/api/community/posts", params={"limit": 10})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert [item["id"] for item in payload["posts"]] == [kept["id"]]


def test_feed_notices_only_on_first_page_and_not_regular_duplicates(client: TestClient, db: Session) -> None:
    as_user(user(db, 1))
    for index in range(12):
        assert post(client, title=f"일반 공지 분리 글 {index:02d}").status_code == 201
    as_user(user(db, 2, "ADMIN"))
    notice = post(client, title="중요 공지", is_notice="true").json()

    page1 = client.get("/api/community/posts", params={"skip": 0, "limit": 10}).json()
    page2 = client.get("/api/community/posts", params={"skip": 10, "limit": 10}).json()

    assert page1["total"] == 12
    assert page1["notices"][0]["id"] == notice["id"]
    assert page1["notices"][0]["is_notice"] is True
    assert notice["id"] not in [item["id"] for item in page1["posts"]]
    assert page2["notices"] == []
    assert len(page2["posts"]) == 2
    assert all(not item["is_notice"] for item in page2["posts"])
    assert notice["id"] not in [item["id"] for item in page2["posts"]]


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
