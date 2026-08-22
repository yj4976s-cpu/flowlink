from collections.abc import Iterator
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.auth import get_current_user, get_optional_current_user
from app.core.security import utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import DaruGameStat, User
from app.services.daru_game import calculate_detection_power, calculate_speed_score, is_better, rank_for, submit_result, validate_result


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


def add_user(db: Session, user_id: int, nickname: str, role: str = "USER") -> User:
    now = utc_now()
    user = User(id=user_id, email=f"{nickname}@example.com", password_hash="unused", nickname=nickname, role=role, active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now)
    db.add(user); db.commit(); return user


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    user = add_user(db, 1, "다루탐정")
    app.dependency_overrides[get_db] = lambda: (yield db)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_optional_current_user] = lambda: user
    with TestClient(app) as test_client: yield test_client
    app.dependency_overrides.clear()


def test_detection_power_uses_each_difficulty_config() -> None:
    assert calculate_detection_power("EASY", 10, 90, 5) == 95
    assert calculate_detection_power("NORMAL", 20, 150, 7) == 83
    assert calculate_detection_power("HARD", 24, 240, 9) == 95


def test_speed_score_is_continuous_and_overtime_is_zero() -> None:
    assert calculate_speed_score(45, 90, 120) == 90
    assert calculate_speed_score(90, 90, 120) == 80
    assert calculate_speed_score(120, 90, 120) == 40
    assert calculate_speed_score(130, 90, 120, within_time_limit=False) == 0


@pytest.mark.parametrize(("power", "rank"), [(80, "S"), (79, "A"), (65, "A"), (64, "B"), (50, "B"), (49, "C")])
def test_rank_thresholds(power: int, rank: str) -> None:
    assert rank_for(power) == rank


def test_best_record_tie_breaks_by_attempts_then_elapsed_time() -> None:
    current = DaruGameStat(best_detection_power=95, best_hints_used=1, best_attempts=20, best_elapsed_seconds=80)
    assert is_better(95, 0, 22, 90, current) is True
    assert is_better(95, 1, 18, 90, current) is True
    assert is_better(95, 1, 20, 75, current) is True
    assert is_better(95, 2, 10, 60, current) is False


def test_result_accumulates_points_and_keeps_better_record(client: TestClient) -> None:
    first = client.post("/api/daru-game/results", json={"difficulty": "NORMAL", "completed": True, "within_time_limit": True, "matched_pairs": 16, "attempts": 20, "elapsed_seconds": 150, "max_combo": 7, "hints_used": 0, "earned_daru_points": 2100})
    assert first.status_code == 200
    assert first.json()["is_new_best"] is True
    second = client.post("/api/daru-game/results", json={"difficulty": "NORMAL", "completed": True, "within_time_limit": True, "matched_pairs": 16, "attempts": 25, "elapsed_seconds": 180, "max_combo": 4, "hints_used": 1, "earned_daru_points": 2200})
    assert second.status_code == 200
    record = second.json()["record"]
    assert second.json()["is_new_best"] is False
    assert record["best_attempts"] == 20
    assert record["total_daru_points"] == 4300
    assert record["play_count"] == 2


def test_leaderboard_orders_detection_then_attempts_then_time(client: TestClient, db: Session) -> None:
    user_b = add_user(db, 2, "빠른다루")
    payload = {"difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300}
    client.post("/api/daru-game/results", json=payload)
    app.dependency_overrides[get_current_user] = lambda: user_b
    client.post("/api/daru-game/results", json={**payload, "attempts": 11, "hints_used": 1})
    response = client.get("/api/daru-game/leaderboard?difficulty=EASY")
    assert response.status_code == 200
    assert [entry["nickname"] for entry in response.json()["entries"]] == ["다루탐정", "빠른다루"]


def test_guest_and_admin_cannot_save_user_ranking(client: TestClient, db: Session) -> None:
    payload = {"difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300}
    app.dependency_overrides.pop(get_current_user)
    assert client.post("/api/daru-game/results", json=payload).status_code == 401
    admin = add_user(db, 3, "관리자", role="ADMIN")
    app.dependency_overrides[get_current_user] = lambda: admin
    assert client.post("/api/daru-game/results", json=payload).status_code == 403


def test_partial_result_keeps_points_without_creating_official_record(client: TestClient) -> None:
    response = client.post("/api/daru-game/results", json={"difficulty": "HARD", "completed": False, "within_time_limit": False, "matched_pairs": 3, "attempts": 5, "elapsed_seconds": 330, "max_combo": 2, "hints_used": 2, "earned_daru_points": 325})
    assert response.status_code == 200
    body = response.json()
    assert body["is_new_best"] is False
    assert body["leaderboard_rank"] is None
    assert body["record"]["total_daru_points"] == 325
    assert body["record"]["best_attempts"] is None


def test_partial_result_rejects_clear_bonus_and_impossible_points() -> None:
    with pytest.raises(ValueError):
        validate_result("EASY", completed=False, within_time_limit=False, matched_pairs=3, attempts=4, elapsed_seconds=120, max_combo=2, hints_used=1, earned_points=600)


@pytest.mark.parametrize(
    "overrides",
    [
        {"within_time_limit": True, "elapsed_seconds": 121},
        {"within_time_limit": False, "elapsed_seconds": 119},
        {"max_combo": 11},
        {"attempts": 9},
        {"completed": True, "matched_pairs": 9},
        {"completed": False, "within_time_limit": True, "matched_pairs": 9},
        {"earned_points": 9999},
    ],
)
def test_result_validation_rejects_cross_field_contradictions(overrides: dict[str, object]) -> None:
    payload = {"completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_points": 1300}
    payload.update(overrides)
    with pytest.raises(ValueError):
        validate_result("EASY", **payload)


def test_first_result_unique_race_reloads_and_updates_existing_record() -> None:
    existing = DaruGameStat(
        id=10,
        user_id=1,
        difficulty="EASY",
        best_detection_power=80,
        best_attempts=15,
        best_elapsed_seconds=100,
        best_combo=4,
        best_hints_used=1,
        total_daru_points=500,
        play_count=1,
        best_achieved_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    session = Mock(spec=Session)
    session.scalar.side_effect = [None, existing]
    session.commit.side_effect = [IntegrityError("insert", {}, Exception("unique")), None]

    stat, improved = submit_result(session, user_id=1, difficulty="EASY", completed=True, within_time_limit=True, matched_pairs=10, attempts=10, elapsed_seconds=90, max_combo=5, hints_used=0, earned_points=1300)

    assert stat is existing
    assert improved is True
    assert stat.total_daru_points == 1800
    assert stat.play_count == 2
    session.rollback.assert_called_once()
    assert session.commit.call_count == 2
