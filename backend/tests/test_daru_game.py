from collections.abc import Iterator
from datetime import timedelta
from decimal import Decimal
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.auth import get_current_user, get_optional_current_user
from app.core.security import utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import DaruGameRun, DaruGameStat, User
from app.services.daru_game import CURRENT_SCORE_VERSION, _round_to_tenth, calculate_detection_power, calculate_hint_score, calculate_memory_accuracy, calculate_speed_score, game_run_lock_query, is_better, rank_for, ranking_query, submit_result, validate_result


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


def create_run(client: TestClient, db: Session, difficulty: str, *, age_seconds: int | None = None) -> str:
    response = client.post("/api/daru-game/runs", json={"difficulty": difficulty})
    assert response.status_code == 201
    run_id = response.json()["run_id"]
    run = db.get(DaruGameRun, UUID(run_id))
    assert run is not None
    default_age = {"EASY": 100, "NORMAL": 160, "HARD": 340}[difficulty]
    run.started_at = utc_now() - timedelta(seconds=age_seconds if age_seconds is not None else default_age)
    db.commit()
    return run_id


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    user = add_user(db, 1, "다루탐정")
    app.dependency_overrides[get_db] = lambda: (yield db)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_optional_current_user] = lambda: user
    with TestClient(app) as test_client: yield test_client
    app.dependency_overrides.clear()


def test_detection_power_uses_each_difficulty_config() -> None:
    assert calculate_detection_power("EASY", 10, 90, 5, 0) == Decimal("95.0")
    assert calculate_detection_power("NORMAL", 20, 150, 7, 1) == Decimal("83.8")
    assert calculate_detection_power("HARD", 24, 240, 9, 2) == Decimal("85.0")


def test_speed_score_is_continuous_and_overtime_is_zero() -> None:
    assert calculate_speed_score(45, 90, 120) == 100
    assert calculate_speed_score(90, 90, 120) == 80
    assert calculate_speed_score(120, 90, 120) == 40
    assert calculate_speed_score(121, 90, 120) == 0
    assert calculate_speed_score(130, 90, 120, within_time_limit=False) == 0


@pytest.mark.parametrize(
    ("pairs", "attempts", "expected"),
    [
        (10, 10, "100"), (10, 15, "75"), (10, 20, "50"), (10, 25, "25"), (10, 30, "0"),
        (16, 24, "75"), (16, 32, "50"), (16, 48, "0"),
        (24, 36, "75"), (24, 48, "50"), (24, 72, "0"),
    ],
)
def test_memory_accuracy_uses_linear_extra_attempt_penalty(pairs: int, attempts: int, expected: str) -> None:
    assert calculate_memory_accuracy(pairs, attempts) == Decimal(expected)


@pytest.mark.parametrize(("hints_used", "expected"), [(0, "100"), (1, "50"), (2, "0")])
def test_hint_score_is_part_of_detection_power(hints_used: int, expected: str) -> None:
    assert calculate_hint_score(hints_used) == Decimal(expected)


@pytest.mark.parametrize(
    ("difficulty", "half", "benchmark", "limit"),
    [("EASY", 45, 90, 120), ("NORMAL", 75, 150, 210), ("HARD", 120, 240, 330)],
)
def test_speed_score_boundaries_for_every_difficulty(difficulty: str, half: int, benchmark: int, limit: int) -> None:
    config = {"EASY": (90, 120), "NORMAL": (150, 210), "HARD": (240, 330)}[difficulty]
    assert config == (benchmark, limit)
    assert calculate_speed_score(half, benchmark, limit) == 100
    assert calculate_speed_score(benchmark, benchmark, limit) == 80
    assert calculate_speed_score(limit, benchmark, limit) == 40
    assert calculate_speed_score(limit + 1, benchmark, limit, within_time_limit=False) == 0


def test_easy_speed_score_midpoints() -> None:
    assert calculate_speed_score(67, 90, 120) == pytest.approx(90.2222222)
    assert calculate_speed_score(68, 90, 120) == pytest.approx(89.7777778)
    assert calculate_speed_score(105, 90, 120) == 60


@pytest.mark.parametrize(
    ("difficulty", "attempts", "elapsed", "combo", "hints", "expected"),
    [
        ("EASY", 15, 80, 4, 0, "80.6"),
        ("NORMAL", 24, 180, 5, 1, "68.2"),
        ("HARD", 36, 270, 6, 2, "64.2"),
    ],
)
def test_v2_representative_detection_scores(difficulty: str, attempts: int, elapsed: int, combo: int, hints: int, expected: str) -> None:
    assert calculate_detection_power(difficulty, attempts, elapsed, combo, hints) == Decimal(expected)


def test_v2_supabase_reference_sample_is_exactly_ninety() -> None:
    assert calculate_memory_accuracy(10, 14) == Decimal("80")
    assert calculate_speed_score(1, 90, 120) == 100
    assert calculate_hint_score(0) == Decimal("100")
    assert calculate_detection_power("EASY", 14, 1, 5, 0) == Decimal("90.0")


@pytest.mark.parametrize(("power", "rank"), [(80, "S"), (79, "A"), (65, "A"), (64, "B"), (50, "B"), (49, "C")])
def test_rank_thresholds(power: int, rank: str) -> None:
    assert rank_for(power) == rank


@pytest.mark.parametrize(("power", "rank"), [(Decimal("80.0"), "S"), (Decimal("79.9"), "A"), (Decimal("65.0"), "A"), (Decimal("64.9"), "B")])
def test_decimal_rank_thresholds(power: Decimal, rank: str) -> None:
    assert rank_for(power) == rank


def test_score_rounding_uses_one_decimal_half_up() -> None:
    assert _round_to_tenth(Decimal("87.64")) == Decimal("87.6")
    assert _round_to_tenth(Decimal("92.05")) == Decimal("92.1")


def test_best_record_tie_breaks_by_attempts_then_elapsed_time() -> None:
    current = DaruGameStat(best_detection_power=Decimal("95.0"), score_version=2, best_hints_used=1, best_attempts=20, best_elapsed_seconds=80)
    assert is_better(Decimal("95.1"), 22, 90, current) is True
    assert is_better(Decimal("95.0"), 18, 90, current) is True
    assert is_better(Decimal("95.0"), 20, 75, current) is True
    assert is_better(Decimal("94.9"), 10, 60, current) is False


def test_best_record_does_not_use_hints_as_a_separate_tie_break() -> None:
    current = DaruGameStat(best_detection_power=Decimal("90.0"), score_version=2, best_hints_used=2, best_attempts=18, best_elapsed_seconds=75)
    assert is_better(Decimal("90.0"), 18, 75, current) is False


def test_result_accumulates_points_and_keeps_better_record(client: TestClient, db: Session) -> None:
    first = client.post("/api/daru-game/results", json={"run_id": create_run(client, db, "NORMAL"), "difficulty": "NORMAL", "completed": True, "within_time_limit": True, "matched_pairs": 16, "attempts": 20, "elapsed_seconds": 150, "max_combo": 7, "hints_used": 0, "earned_daru_points": 2100})
    assert first.status_code == 200
    assert first.json()["is_new_best"] is True
    second = client.post("/api/daru-game/results", json={"run_id": create_run(client, db, "NORMAL", age_seconds=190), "difficulty": "NORMAL", "completed": True, "within_time_limit": True, "matched_pairs": 16, "attempts": 25, "elapsed_seconds": 180, "max_combo": 4, "hints_used": 1, "earned_daru_points": 2200})
    assert second.status_code == 200
    record = second.json()["record"]
    assert second.json()["is_new_best"] is False
    assert record["best_attempts"] == 20
    assert record["total_daru_points"] == 4300
    assert record["play_count"] == 2


def test_leaderboard_orders_detection_then_attempts_then_time(client: TestClient, db: Session) -> None:
    user_b = add_user(db, 2, "빠른다루")
    payload = {"difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300}
    client.post("/api/daru-game/results", json={**payload, "run_id": create_run(client, db, "EASY")})
    app.dependency_overrides[get_current_user] = lambda: user_b
    client.post("/api/daru-game/results", json={**payload, "run_id": create_run(client, db, "EASY"), "attempts": 11, "hints_used": 1})
    response = client.get("/api/daru-game/leaderboard?difficulty=EASY")
    assert response.status_code == 200
    assert [entry["nickname"] for entry in response.json()["entries"]] == ["다루탐정", "빠른다루"]


def test_v2_ranking_orders_score_attempts_elapsed_then_achieved_at(db: Session) -> None:
    now = utc_now()
    users = [add_user(db, index, nickname) for index, nickname in enumerate(["점수우선", "낮은점수", "시도우선", "시간우선", "달성우선"], 1)]
    rows = [
        (users[0], "90.5", 2, 20, 100, now - timedelta(minutes=5)),
        (users[1], "90.4", 0, 10, 50, now - timedelta(minutes=10)),
        (users[2], "90.5", 0, 18, 110, now - timedelta(minutes=8)),
        (users[3], "90.5", 2, 18, 90, now - timedelta(minutes=4)),
        (users[4], "90.5", 1, 18, 90, now - timedelta(minutes=9)),
    ]
    for user, score, hints, attempts, elapsed, achieved in rows:
        db.add(DaruGameStat(user_id=user.id, difficulty="EASY", best_detection_power=Decimal(score), score_version=2, best_attempts=attempts, best_elapsed_seconds=elapsed, best_combo=5, best_hints_used=hints, total_daru_points=0, play_count=1, best_achieved_at=achieved, created_at=now, updated_at=now))
    db.commit()
    assert [nickname for _stat, nickname in db.execute(ranking_query("EASY")).all()] == ["달성우선", "시간우선", "시도우선", "점수우선", "낮은점수"]


def test_v1_record_is_hidden_until_first_v2_official_result(client: TestClient, db: Session) -> None:
    now = utc_now()
    legacy = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=Decimal("99.0"), score_version=1, best_attempts=10, best_elapsed_seconds=45, best_combo=5, best_hints_used=0, total_daru_points=500, play_count=3, best_achieved_at=now, created_at=now, updated_at=now)
    db.add(legacy); db.commit()
    assert client.get("/api/daru-game/leaderboard?difficulty=EASY").json()["entries"] == []

    payload = {"run_id": create_run(client, db, "EASY"), "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 15, "elapsed_seconds": 80, "max_combo": 4, "hints_used": 0, "earned_daru_points": 1300}
    response = client.post("/api/daru-game/results", json=payload)
    assert response.status_code == 200
    record = response.json()["record"]
    assert response.json()["is_new_best"] is True
    assert record["score_version"] == CURRENT_SCORE_VERSION
    assert record["best_detection_power"] == 80.6
    assert record["total_daru_points"] == 1800
    assert record["play_count"] == 4
    assert client.get("/api/daru-game/leaderboard?difficulty=EASY").json()["entries"][0]["best_detection_power"] == 80.6


def test_partial_result_keeps_v1_best_and_accumulates_rewards(client: TestClient, db: Session) -> None:
    now = utc_now()
    legacy = DaruGameStat(user_id=1, difficulty="HARD", best_detection_power=Decimal("88.0"), score_version=1, best_attempts=30, best_elapsed_seconds=300, best_combo=7, best_hints_used=1, total_daru_points=400, play_count=2, best_achieved_at=now, created_at=now, updated_at=now)
    db.add(legacy); db.commit()
    response = client.post("/api/daru-game/results", json={"run_id": create_run(client, db, "HARD"), "difficulty": "HARD", "completed": False, "within_time_limit": False, "matched_pairs": 3, "attempts": 5, "elapsed_seconds": 330, "max_combo": 2, "hints_used": 2, "earned_daru_points": 325})
    assert response.status_code == 200
    record = response.json()["record"]
    assert response.json()["is_new_best"] is False
    assert record["score_version"] == 1
    assert record["best_detection_power"] == 88.0
    assert record["total_daru_points"] == 725
    assert record["play_count"] == 3


def test_me_response_exposes_legacy_version_for_client_side_best_filtering(client: TestClient, db: Session) -> None:
    now = utc_now()
    db.add(DaruGameStat(user_id=1, difficulty="NORMAL", best_detection_power=Decimal("97.0"), score_version=1, best_attempts=16, best_elapsed_seconds=80, best_combo=7, best_hints_used=0, total_daru_points=900, play_count=5, best_achieved_at=now, created_at=now, updated_at=now))
    db.commit()
    response = client.get("/api/daru-game/me")
    assert response.status_code == 200
    record = response.json()[0]
    assert record["score_version"] == 1
    assert record["best_detection_power"] == 97.0
    assert record["total_daru_points"] == 900
    assert record["play_count"] == 5


def test_guest_and_admin_cannot_save_user_ranking(client: TestClient, db: Session) -> None:
    payload = {"run_id": str(uuid4()), "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300}
    app.dependency_overrides.pop(get_current_user)
    assert client.post("/api/daru-game/results", json=payload).status_code == 401
    admin = add_user(db, 3, "관리자", role="ADMIN")
    app.dependency_overrides[get_current_user] = lambda: admin
    assert client.post("/api/daru-game/results", json=payload).status_code == 403


def test_partial_result_keeps_points_without_creating_official_record(client: TestClient, db: Session) -> None:
    response = client.post("/api/daru-game/results", json={"run_id": create_run(client, db, "HARD"), "difficulty": "HARD", "completed": False, "within_time_limit": False, "matched_pairs": 3, "attempts": 5, "elapsed_seconds": 330, "max_combo": 2, "hints_used": 2, "earned_daru_points": 325})
    assert response.status_code == 200
    body = response.json()
    assert body["is_new_best"] is False
    assert body["leaderboard_rank"] is None
    assert body["record"]["total_daru_points"] == 325
    assert body["record"]["best_attempts"] is None
    assert body["record"]["score_version"] == CURRENT_SCORE_VERSION


def test_user_can_create_game_run(client: TestClient, db: Session) -> None:
    response = client.post("/api/daru-game/runs", json={"difficulty": "EASY"})
    assert response.status_code == 201
    run = db.get(DaruGameRun, UUID(response.json()["run_id"]))
    assert run is not None
    assert run.user_id == 1
    assert run.difficulty == "EASY"
    assert run.consumed_at is None


def test_guest_and_admin_cannot_create_game_run(client: TestClient, db: Session) -> None:
    app.dependency_overrides.pop(get_current_user)
    assert client.post("/api/daru-game/runs", json={"difficulty": "EASY"}).status_code == 401
    admin = add_user(db, 3, "관리자", role="ADMIN")
    app.dependency_overrides[get_current_user] = lambda: admin
    assert client.post("/api/daru-game/runs", json={"difficulty": "EASY"}).status_code == 403


def test_result_rejects_another_users_run(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY")
    other_user = add_user(db, 2, "다른다루")
    app.dependency_overrides[get_current_user] = lambda: other_user
    response = client.post("/api/daru-game/results", json={"run_id": run_id, "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300})
    assert response.status_code == 404
    assert db.get(DaruGameRun, UUID(run_id)).consumed_at is None


def test_result_rejects_run_difficulty_mismatch(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY")
    response = client.post("/api/daru-game/results", json={"run_id": run_id, "difficulty": "NORMAL", "completed": True, "within_time_limit": True, "matched_pairs": 16, "attempts": 16, "elapsed_seconds": 150, "max_combo": 7, "hints_used": 0, "earned_daru_points": 2100})
    assert response.status_code == 422
    assert db.get(DaruGameRun, UUID(run_id)).consumed_at is None


def test_replayed_run_is_rejected_without_changing_points_or_play_count(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY")
    payload = {"run_id": run_id, "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300}
    assert client.post("/api/daru-game/results", json=payload).status_code == 200
    replay = client.post("/api/daru-game/results", json=payload)
    assert replay.status_code == 409
    stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == 1, DaruGameStat.difficulty == "EASY"))
    assert stat is not None
    assert stat.total_daru_points == 1300
    assert stat.play_count == 1


def test_result_rejects_elapsed_time_longer_than_server_run(client: TestClient, db: Session) -> None:
    response = client.post("/api/daru-game/runs", json={"difficulty": "EASY"})
    run_id = response.json()["run_id"]
    result = client.post("/api/daru-game/results", json={"run_id": run_id, "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300})
    assert result.status_code == 422
    assert db.get(DaruGameRun, UUID(run_id)).consumed_at is None


@pytest.mark.parametrize(
    ("difficulty", "elapsed_seconds", "server_age", "pairs", "combo", "points"),
    [
        ("EASY", 90, 97, 10, 5, 1300),
        ("NORMAL", 150, 159, 16, 7, 2100),
        ("HARD", 240, 251, 24, 9, 3100),
    ],
)
def test_normal_elapsed_is_accepted_for_every_difficulty(client: TestClient, db: Session, difficulty: str, elapsed_seconds: int, server_age: int, pairs: int, combo: int, points: int) -> None:
    run_id = create_run(client, db, difficulty, age_seconds=server_age)
    result = client.post("/api/daru-game/results", json={"run_id": run_id, "difficulty": difficulty, "completed": True, "within_time_limit": True, "matched_pairs": pairs, "attempts": pairs, "elapsed_seconds": elapsed_seconds, "max_combo": combo, "hints_used": 0, "earned_daru_points": points})
    assert result.status_code == 200


@pytest.mark.parametrize("elapsed_seconds", [1, 5, 10])
def test_result_rejects_implausibly_short_elapsed_time(client: TestClient, db: Session, elapsed_seconds: int) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=100)
    result = client.post("/api/daru-game/results", json={"run_id": run_id, "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": elapsed_seconds, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300})
    assert result.status_code == 422
    assert db.get(DaruGameRun, UUID(run_id)).consumed_at is None


def test_preview_ready_and_network_allowance_is_accepted(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=117)
    result = client.post("/api/daru-game/results", json={"run_id": run_id, "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300})
    assert result.status_code == 200


def test_result_rejects_expired_game_run(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=24 * 60 * 60 + 1)
    result = client.post("/api/daru-game/results", json={"run_id": run_id, "difficulty": "EASY", "completed": True, "within_time_limit": True, "matched_pairs": 10, "attempts": 10, "elapsed_seconds": 90, "max_combo": 5, "hints_used": 0, "earned_daru_points": 1300})
    assert result.status_code == 409
    assert db.get(DaruGameRun, UUID(run_id)).consumed_at is None


def test_partial_then_first_official_result_has_no_previous_official_best(client: TestClient, db: Session) -> None:
    partial = client.post("/api/daru-game/results", json={"run_id": create_run(client, db, "HARD"), "difficulty": "HARD", "completed": False, "within_time_limit": False, "matched_pairs": 3, "attempts": 5, "elapsed_seconds": 330, "max_combo": 2, "hints_used": 2, "earned_daru_points": 325})
    assert partial.json()["record"]["best_attempts"] is None
    official = client.post("/api/daru-game/results", json={"run_id": create_run(client, db, "HARD", age_seconds=250), "difficulty": "HARD", "completed": True, "within_time_limit": True, "matched_pairs": 24, "attempts": 24, "elapsed_seconds": 240, "max_combo": 9, "hints_used": 0, "earned_daru_points": 3100})
    assert official.status_code == 200
    assert official.json()["is_new_best"] is True
    assert official.json()["record"]["best_attempts"] == 24


def test_game_run_consumption_query_locks_the_row() -> None:
    sql = str(game_run_lock_query(uuid4()).compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in sql


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
    run_id = uuid4()
    first_run = DaruGameRun(id=run_id, user_id=1, difficulty="EASY", started_at=utc_now() - timedelta(seconds=100))
    retried_run = DaruGameRun(id=run_id, user_id=1, difficulty="EASY", started_at=utc_now() - timedelta(seconds=100))
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
    session.scalar.side_effect = [first_run, None, retried_run, existing]
    session.commit.side_effect = [IntegrityError("insert", {}, Exception("unique")), None]

    stat, improved = submit_result(session, run_id=run_id, user_id=1, difficulty="EASY", completed=True, within_time_limit=True, matched_pairs=10, attempts=10, elapsed_seconds=90, max_combo=5, hints_used=0, earned_points=1300)

    assert stat is existing
    assert improved is True
    assert stat.total_daru_points == 1800
    assert stat.play_count == 2
    assert retried_run.consumed_at is not None
    session.rollback.assert_called_once()
    assert session.commit.call_count == 2
