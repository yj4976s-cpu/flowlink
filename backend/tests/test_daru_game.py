from collections.abc import Iterator
from datetime import timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.auth import get_current_user, get_optional_current_user
from app.core.config import get_settings
from app.core.security import utc_now
from app.db.session import Base, get_db
from app.main import app
from app.models import DaruGameRun, DaruGameRunAction, DaruGameStat, User
from app.services.daru_game import DIFFICULTY_CONFIG, HARD_ADDITIONAL_CARD_IDS, NORMAL_CARD_IDS, _round_to_tenth, calculate_detection_power, calculate_hint_score, calculate_memory_accuracy, calculate_speed_score, detection_metrics, game_run_lock_query, is_better, rank_for, ranking_query, select_card_ids


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


def action_json(**payload: object) -> dict[str, object]:
    return {"action_id": str(uuid4()), **payload}


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
    assert calculate_detection_power("HARD", 20, 200, 8, 2) == Decimal("85.0")


def test_hard_balance_config_uses_twenty_pairs_and_new_timing() -> None:
    assert DIFFICULTY_CONFIG["HARD"] == {
        "pairs": 20,
        "time_limit_seconds": 280,
        "speed_benchmark_seconds": 200,
        "combo_target": 8,
        "clear_bonus": 700,
        "preview_seconds": 8,
    }


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
        (20, 20, "100"), (20, 30, "75"), (20, 40, "50"), (20, 50, "25"), (20, 60, "0"),
    ],
)
def test_memory_accuracy_uses_linear_extra_attempt_penalty(pairs: int, attempts: int, expected: str) -> None:
    assert calculate_memory_accuracy(pairs, attempts) == Decimal(expected)


@pytest.mark.parametrize(("hints_used", "expected"), [(0, "100"), (1, "50"), (2, "0")])
def test_hint_score_is_part_of_detection_power(hints_used: int, expected: str) -> None:
    assert calculate_hint_score(hints_used) == Decimal(expected)


@pytest.mark.parametrize(
    ("difficulty", "half", "benchmark", "limit"),
    [("EASY", 45, 90, 120), ("NORMAL", 75, 150, 210), ("HARD", 100, 200, 280)],
)
def test_speed_score_boundaries_for_every_difficulty(difficulty: str, half: int, benchmark: int, limit: int) -> None:
    config = {"EASY": (90, 120), "NORMAL": (150, 210), "HARD": (200, 280)}[difficulty]
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
    ("elapsed", "expected"),
    [(100, 100), (150, 90), (200, 80), (240, 60), (280, 40), (281, 0)],
)
def test_hard_speed_score_boundaries(elapsed: int, expected: int) -> None:
    assert calculate_speed_score(elapsed, 200, 280) == expected


@pytest.mark.parametrize(("combo", "expected"), [(4, "50.0"), (6, "75.0"), (8, "100.0"), (9, "100.0")])
def test_hard_combo_target_is_eight(combo: int, expected: str) -> None:
    assert detection_metrics("HARD", 20, 100, combo, 0, True)["combo_score"] == Decimal(expected)


@pytest.mark.parametrize(
    ("difficulty", "attempts", "elapsed", "combo", "hints", "expected"),
    [
        ("EASY", 15, 80, 4, 0, "80.6"),
        ("NORMAL", 24, 180, 5, 1, "68.2"),
        ("HARD", 30, 270, 6, 2, "60.0"),
    ],
)
def test_v2_representative_detection_scores(difficulty: str, attempts: int, elapsed: int, combo: int, hints: int, expected: str) -> None:
    assert calculate_detection_power(difficulty, attempts, elapsed, combo, hints) == Decimal(expected)


@pytest.mark.parametrize(
    ("attempts", "elapsed", "combo", "hints", "expected"),
    [(20, 100, 8, 0, "100.0"), (25, 150, 6, 0, "87.5"), (30, 180, 5, 1, "72.9"), (35, 200, 4, 1, "63.8")],
)
def test_hard_new_balance_score_samples(attempts: int, elapsed: int, combo: int, hints: int, expected: str) -> None:
    assert calculate_detection_power("HARD", attempts, elapsed, combo, hints) == Decimal(expected)


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


def start_authoritative_run(client: TestClient, db: Session, difficulty: str = "EASY", *, elapsed_seconds: int = 90) -> tuple[str, DaruGameRun]:
    run_id = create_run(client, db, difficulty, age_seconds=0)
    assert client.post(f"/api/daru-game/runs/{run_id}/start", json=action_json()).status_code == 200
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    card_ids = list(dict.fromkeys(run.deck_state))
    run.deck_state = [card_id for card_id in card_ids for _copy in range(2)]
    run.play_started_at = utc_now() - timedelta(seconds=elapsed_seconds)
    db.commit()
    return run_id, run


def complete_pairs(client: TestClient, run_id: str, pair_count: int) -> None:
    for pair_index in range(pair_count):
        assert client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=pair_index * 2)).status_code == 200
        assert client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=pair_index * 2 + 1)).status_code == 200


def test_run_creation_returns_positions_without_deck_identity(client: TestClient, db: Session) -> None:
    response = client.post("/api/daru-game/runs", json={"difficulty": "EASY"})
    assert response.status_code == 201
    assert response.json()["positions"] == list(range(20))
    assert "deck_state" not in response.json()


class FrontLoadingRandom:
    def __init__(self, front: list[str]) -> None:
        self.front = front

    def shuffle(self, values: list[str]) -> None:
        order = {value: index for index, value in enumerate(self.front)}
        values.sort(key=lambda value: order.get(value, len(order)))


def test_hard_card_selection_keeps_normal_base_and_selects_four_unique_additional_cards() -> None:
    selected = select_card_ids("HARD", FrontLoadingRandom(["proud", "shy", "styrofoam", "splash"]))
    assert len(selected) == 20
    assert len(set(selected)) == 20
    assert selected[:16] == NORMAL_CARD_IDS
    assert selected[16:] == ["proud", "shy", "styrofoam", "splash"]
    assert set(selected[16:]) <= set(HARD_ADDITIONAL_CARD_IDS)


def test_hard_card_selection_can_produce_different_deterministic_subsets() -> None:
    first = select_card_ids("HARD", FrontLoadingRandom(["shy", "splash", "branch-play", "plastic-sort"]))
    second = select_card_ids("HARD", FrontLoadingRandom(["shoe-found", "backpack-found", "proud", "styrofoam"]))
    assert first[16:] != second[16:]
    assert len(set(first[16:])) == len(set(second[16:])) == 4


@pytest.mark.parametrize(("difficulty", "card_count"), [("EASY", 20), ("NORMAL", 32), ("HARD", 40)])
def test_created_run_preview_returns_full_owner_deck(client: TestClient, db: Session, difficulty: str, card_count: int) -> None:
    run_id = create_run(client, db, difficulty, age_seconds=0)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    response = client.get(f"/api/daru-game/runs/{run_id}/preview")
    assert response.status_code == 200
    assert response.json()["cards"] == [{"position": position, "card_id": card_id} for position, card_id in enumerate(run.deck_state)]
    assert len(response.json()["cards"]) == card_count
    state = client.get(f"/api/daru-game/runs/{run_id}/state").json()
    assert state["visible_cards"] == [] and "deck_state" not in state


def test_created_hard_deck_has_twenty_unique_pairs_with_normal_base(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "HARD", age_seconds=0)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    counts = {card_id: run.deck_state.count(card_id) for card_id in set(run.deck_state)}
    additional = set(counts) - set(NORMAL_CARD_IDS)
    assert len(run.deck_state) == 40
    assert len(counts) == 20
    assert all(count == 2 for count in counts.values())
    assert set(NORMAL_CARD_IDS) <= set(counts)
    assert len(additional) == 4 and additional <= set(HARD_ADDITIONAL_CARD_IDS)


def test_run_preview_is_owner_only(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=0)
    other = add_user(db, 2, "preview-other")
    app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(f"/api/daru-game/runs/{run_id}/preview").status_code == 404


def test_run_preview_is_rejected_after_start(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=0)
    assert client.get(f"/api/daru-game/runs/{run_id}/preview").status_code == 200
    assert client.post(f"/api/daru-game/runs/{run_id}/start", json=action_json()).status_code == 200
    assert client.get(f"/api/daru-game/runs/{run_id}/preview").status_code == 409


def test_run_preview_is_rejected_for_consumed_run(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=0)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    run.consumed_at = utc_now(); db.commit()
    assert client.get(f"/api/daru-game/runs/{run_id}/preview").status_code == 409


def test_fake_perfect_metrics_and_points_are_rejected(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    payload = action_json(run_id=run_id, attempts=10, matched_pairs=10, max_combo=10, hints_used=0, elapsed_seconds=45, earned_daru_points=9999)
    assert client.post("/api/daru-game/results", json=payload).status_code == 422
    assert db.scalar(select(DaruGameStat)) is None


def test_incomplete_run_cannot_complete(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    assert client.post("/api/daru-game/results", json=action_json(run_id=run_id)).status_code == 422


def test_server_authoritative_perfect_easy_run(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, elapsed_seconds=90)
    complete_pairs(client, run_id, 10)
    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.status_code == 200
    metrics = response.json()["metrics"]
    assert metrics["attempts"] == 10 and metrics["matched_pairs"] == 10
    assert metrics["max_combo"] == 10 and metrics["hints_used"] == 0
    assert metrics["detection_power"] == 95.0
    assert metrics["earned_daru_points"] == 2050


def test_server_authoritative_perfect_hard_run_uses_twenty_pairs(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, "HARD", elapsed_seconds=240)
    complete_pairs(client, run_id, 20)
    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.status_code == 200
    metrics = response.json()["metrics"]
    assert metrics["attempts"] == 20 and metrics["matched_pairs"] == 20
    assert metrics["memory_accuracy"] == 100.0
    assert metrics["earned_daru_points"] == 4450


def test_hard_completion_rejects_nineteen_and_twenty_one_pairs(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, "HARD", elapsed_seconds=240)
    complete_pairs(client, run_id, 19)
    assert client.post("/api/daru-game/results", json=action_json(run_id=run_id)).status_code == 422

    overflow_run_id, overflow_run = start_authoritative_run(client, db, "HARD", elapsed_seconds=240)
    overflow_run.matched_pairs = 21
    db.commit()
    assert client.post("/api/daru-game/results", json=action_json(run_id=overflow_run_id)).status_code == 422


def test_mismatch_increments_attempt_and_resets_combo(client: TestClient, db: Session) -> None:
    run_id, run = start_authoritative_run(client, db)
    run.current_combo = 3; run.max_combo = 3; db.commit()
    client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0))
    response = client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=2))
    assert response.json()["matched"] is False
    assert response.json()["attempts"] == 1
    assert response.json()["matched_pairs"] == 0
    assert response.json()["current_combo"] == 0


@pytest.mark.parametrize(("matches", "expected_points"), [(1, 100), (2, 225), (3, 375), (4, 550), (5, 750), (6, 950)])
def test_server_combo_and_point_curve(client: TestClient, db: Session, matches: int, expected_points: int) -> None:
    run_id, _run = start_authoritative_run(client, db)
    complete_pairs(client, run_id, matches)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    assert run.current_combo == matches and run.max_combo == matches
    assert run.earned_daru_points == expected_points


@pytest.mark.parametrize(("hint_count", "expected_hint_score"), [(0, 100.0), (1, 50.0), (2, 0.0)])
def test_hint_endpoint_controls_score(client: TestClient, db: Session, hint_count: int, expected_hint_score: float) -> None:
    run_id, _run = start_authoritative_run(client, db)
    for expected_used in range(1, hint_count + 1):
        response = client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json())
        assert response.status_code == 200 and response.json()["hints_used"] == expected_used
    complete_pairs(client, run_id, 10)
    result = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert result.json()["metrics"]["hint_score"] == expected_hint_score


def test_third_hint_is_rejected(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    assert client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json()).status_code == 200
    assert client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json()).status_code == 200
    assert client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json()).status_code == 409


def test_completion_replay_flip_and_hint_are_rejected_without_double_points(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    complete_pairs(client, run_id, 10)
    assert client.post("/api/daru-game/results", json=action_json(run_id=run_id)).status_code == 200
    assert client.post("/api/daru-game/results", json=action_json(run_id=run_id)).status_code == 409
    assert client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0)).status_code == 409
    assert client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json()).status_code == 409
    stat = db.scalar(select(DaruGameStat)); assert stat is not None
    assert stat.total_daru_points == 2050 and stat.play_count == 1


@pytest.mark.parametrize("action", ["start", "flip", "hint", "complete"])
def test_other_user_cannot_operate_run(client: TestClient, db: Session, action: str) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=0)
    other = add_user(db, 2, f"other-{action}")
    app.dependency_overrides[get_current_user] = lambda: other
    if action == "start": response = client.post(f"/api/daru-game/runs/{run_id}/start", json=action_json())
    elif action == "flip": response = client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0))
    elif action == "hint": response = client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json())
    else: response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.status_code == 404


def test_difficulty_cannot_be_overridden_at_completion(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    assert client.post("/api/daru-game/results", json=action_json(run_id=run_id, difficulty="HARD")).status_code == 422


def test_server_timestamp_controls_elapsed_and_timeout(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, elapsed_seconds=121)
    complete_pairs(client, run_id, 10)
    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.status_code == 200
    assert response.json()["metrics"]["within_time_limit"] is False
    assert response.json()["leaderboard_rank"] is None


def test_hard_server_timeout_uses_new_280_second_limit(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, "HARD", elapsed_seconds=281)
    complete_pairs(client, run_id, 20)
    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.status_code == 200
    assert response.json()["metrics"]["within_time_limit"] is False
    assert response.json()["metrics"]["speed_score"] == 0.0
    assert response.json()["leaderboard_rank"] is None


def test_partial_timeout_uses_server_points_without_official_record(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, elapsed_seconds=121)
    complete_pairs(client, run_id, 2)
    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id, finish_partial=True))
    assert response.status_code == 200
    assert response.json()["metrics"]["earned_daru_points"] == 225
    assert response.json()["record"]["best_attempts"] is None


def test_v1_first_authoritative_v2_result_preserves_totals(client: TestClient, db: Session) -> None:
    now = utc_now()
    db.add(DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=Decimal("99.0"), score_version=1, best_attempts=10, best_elapsed_seconds=45, best_combo=5, best_hints_used=0, total_daru_points=500, play_count=3, best_achieved_at=now, created_at=now, updated_at=now)); db.commit()
    run_id, _run = start_authoritative_run(client, db)
    complete_pairs(client, run_id, 10)
    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.json()["is_new_best"] is True
    assert response.json()["record"]["score_version"] == 2
    assert response.json()["record"]["total_daru_points"] == 2550
    assert response.json()["record"]["play_count"] == 4


def test_v2_ranking_orders_score_attempts_elapsed_then_achieved_at(db: Session) -> None:
    now = utc_now()
    users = [add_user(db, index, nickname) for index, nickname in enumerate(["score", "lower", "attempt", "time", "first"], 1)]
    rows = [(users[0], "90.5", 20, 100, now - timedelta(minutes=5)), (users[1], "90.4", 10, 50, now), (users[2], "90.5", 18, 110, now), (users[3], "90.5", 18, 90, now), (users[4], "90.5", 18, 90, now - timedelta(minutes=9))]
    for user, score, attempts, elapsed, achieved in rows: db.add(DaruGameStat(user_id=user.id, difficulty="EASY", best_detection_power=Decimal(score), score_version=2, best_attempts=attempts, best_elapsed_seconds=elapsed, best_combo=5, best_hints_used=0, total_daru_points=0, play_count=1, best_achieved_at=achieved, created_at=now, updated_at=now))
    db.commit()
    assert [nickname for _stat, nickname in db.execute(ranking_query("EASY")).all()] == ["first", "time", "attempt", "score", "lower"]


def test_game_run_actions_lock_the_row() -> None:
    assert "FOR UPDATE" in str(game_run_lock_query(uuid4()).compile(dialect=postgresql.dialect()))


@pytest.mark.parametrize("position", [-1, 20, 999])
def test_flip_rejects_invalid_positions(client: TestClient, db: Session, position: int) -> None:
    run_id, _run = start_authoritative_run(client, db)
    assert client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=position)).status_code == 422


def test_same_position_cannot_be_flipped_twice(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    assert client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0)).status_code == 200
    assert client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0)).status_code == 422


def test_run_cannot_start_twice(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    assert client.post(f"/api/daru-game/runs/{run_id}/start", json=action_json()).status_code == 409


@pytest.mark.parametrize("action", ["flip", "hint", "complete"])
def test_actions_require_started_run(client: TestClient, db: Session, action: str) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=0)
    if action == "flip": response = client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0))
    elif action == "hint": response = client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json())
    else: response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.status_code == 409


def test_hint_is_rejected_mid_attempt(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0))
    assert client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json()).status_code == 409


def test_partial_finish_is_rejected_before_timeout(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, elapsed_seconds=30)
    assert client.post("/api/daru-game/results", json=action_json(run_id=run_id, finish_partial=True)).status_code == 422


@pytest.mark.parametrize("role,expected", [(None, 401), ("ADMIN", 403)])
def test_guest_and_admin_cannot_create_authoritative_runs(client: TestClient, db: Session, role: str | None, expected: int) -> None:
    if role is None: app.dependency_overrides.pop(get_current_user)
    else:
        admin = add_user(db, 3, "admin", role=role)
        app.dependency_overrides[get_current_user] = lambda: admin
    assert client.post("/api/daru-game/runs", json={"difficulty": "EASY"}).status_code == expected


def test_creating_authenticated_run_renews_login_cookie(client: TestClient, db: Session) -> None:
    response = client.post("/api/daru-game/runs", json={"difficulty": "HARD"})
    settings = get_settings()
    set_cookie = response.headers["set-cookie"]
    assert response.status_code == 201
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES == 480
    assert f"{settings.AUTH_COOKIE_NAME}=" in set_cookie
    assert "Max-Age=28800" in set_cookie
    assert "HttpOnly" in set_cookie and "SameSite=lax" in set_cookie


def test_state_rejects_expired_active_run(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=24 * 60 * 60 + 1)
    response = client.get(f"/api/daru-game/runs/{run_id}/state")
    assert response.status_code == 409
    assert response.json()["detail"] == "Game run has expired"


def test_start_response_loss_retry_is_idempotent(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=0)
    action_id = str(uuid4())
    first = client.post(f"/api/daru-game/runs/{run_id}/start", json={"action_id": action_id})
    started_at = db.get(DaruGameRun, UUID(run_id)).play_started_at
    retry = client.post(f"/api/daru-game/runs/{run_id}/start", json={"action_id": action_id})
    assert first.status_code == retry.status_code == 200
    assert first.json() == retry.json()
    assert db.get(DaruGameRun, UUID(run_id)).play_started_at == started_at


def test_first_flip_response_loss_retry_is_idempotent(client: TestClient, db: Session) -> None:
    run_id, run = start_authoritative_run(client, db)
    action_id = str(uuid4()); payload = {"action_id": action_id, "position": 3}
    first = client.post(f"/api/daru-game/runs/{run_id}/flip", json=payload)
    retry = client.post(f"/api/daru-game/runs/{run_id}/flip", json=payload)
    db.refresh(run)
    assert first.json() == retry.json()
    assert run.first_position == 3 and run.attempts == 0


@pytest.mark.parametrize(("second_position", "matched"), [(1, True), (2, False)])
def test_second_flip_response_loss_retry_changes_state_once(client: TestClient, db: Session, second_position: int, matched: bool) -> None:
    run_id, run = start_authoritative_run(client, db)
    client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0))
    action_id = str(uuid4()); payload = {"action_id": action_id, "position": second_position}
    first = client.post(f"/api/daru-game/runs/{run_id}/flip", json=payload)
    retry = client.post(f"/api/daru-game/runs/{run_id}/flip", json=payload)
    db.refresh(run)
    assert first.json() == retry.json() and first.json()["matched"] is matched
    assert run.attempts == 1
    assert run.matched_pairs == (1 if matched else 0)
    assert run.earned_daru_points == (100 if matched else 0)


def test_hint_response_loss_retry_does_not_consume_twice(client: TestClient, db: Session) -> None:
    run_id, run = start_authoritative_run(client, db)
    payload = {"action_id": str(uuid4())}
    first = client.post(f"/api/daru-game/runs/{run_id}/hint", json=payload)
    retry = client.post(f"/api/daru-game/runs/{run_id}/hint", json=payload)
    db.refresh(run)
    assert first.json() == retry.json()
    assert run.hints_used == 1


def test_completion_response_loss_retry_returns_snapshot_without_double_award(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    complete_pairs(client, run_id, 10)
    payload = {"run_id": run_id, "action_id": str(uuid4())}
    first = client.post("/api/daru-game/results", json=payload)
    stat = db.scalar(select(DaruGameStat)); assert stat is not None
    totals = (stat.total_daru_points, stat.play_count, stat.best_achieved_at)
    retry = client.post("/api/daru-game/results", json=payload)
    db.refresh(stat)
    assert first.status_code == retry.status_code == 200 and first.json() == retry.json()
    assert (stat.total_daru_points, stat.play_count, stat.best_achieved_at) == totals
    assert len(db.scalars(select(DaruGameRunAction).where(DaruGameRunAction.action_type == "COMPLETE")).all()) == 1


def test_action_id_reuse_with_different_payload_or_type_conflicts(client: TestClient, db: Session) -> None:
    run_id, run = start_authoritative_run(client, db)
    action_id = str(uuid4())
    assert client.post(f"/api/daru-game/runs/{run_id}/flip", json={"action_id": action_id, "position": 0}).status_code == 200
    assert client.post(f"/api/daru-game/runs/{run_id}/flip", json={"action_id": action_id, "position": 1}).status_code == 409
    assert client.post(f"/api/daru-game/runs/{run_id}/hint", json={"action_id": action_id}).status_code == 409
    db.refresh(run)
    assert run.first_position == 0 and run.attempts == 0 and run.hints_used == 0


def test_state_endpoint_hides_unknown_cards_and_restores_first_and_matched_cards(client: TestClient, db: Session) -> None:
    run_id, run = start_authoritative_run(client, db)
    initial = client.get(f"/api/daru-game/runs/{run_id}/state").json()
    assert initial["visible_cards"] == [] and "deck_state" not in initial
    client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0))
    first = client.get(f"/api/daru-game/runs/{run_id}/state").json()
    assert first["first_position"] == 0 and first["visible_cards"] == [{"position": 0, "card_id": run.deck_state[0]}]
    client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=1))
    matched = client.get(f"/api/daru-game/runs/{run_id}/state").json()
    assert matched["matched_positions"] == [0, 1] and matched["matched_pairs"] == 1
    assert {card["position"] for card in matched["visible_cards"]} == {0, 1}
    assert len(matched["visible_cards"]) == 2


def test_state_endpoint_is_owner_only_and_restores_completion_result(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db)
    complete_pairs(client, run_id, 10)
    result = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    state = client.get(f"/api/daru-game/runs/{run_id}/state")
    assert state.status_code == 200 and state.json()["status"] == "COMPLETED"
    assert state.json()["completion_result"] == result.json()
    other = add_user(db, 2, "state-other")
    app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(f"/api/daru-game/runs/{run_id}/state").status_code == 404
