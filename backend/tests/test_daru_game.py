from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import random
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
from app.models import DaruGamePlayRecord, DaruGameRun, DaruGameRunAction, DaruGameStat, User
from app.services.daru_game import DIFFICULTY_CONFIG, GAME_RUN_MAX_AGE, HARD_ADDITIONAL_CARD_IDS, NORMAL_CARD_IDS, GameRunExpiredError, _ensure_not_expired, _round_to_tenth, calculate_detection_power, calculate_hint_score, calculate_memory_accuracy, calculate_speed_score, constrained_shuffle, create_shuffled_deck, detection_metrics, game_run_lock_query, has_adjacent_pair, has_adjacent_pair_for_columns, is_better, rank_for, ranking_query, select_card_ids, soft_delete_all_play_records, soft_delete_play_record


@compiles(BigInteger, "sqlite")
def compile_big_integer_for_sqlite(_type, _compiler, **_kwargs) -> str:
    return "INTEGER"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, autoflush=False, expire_on_commit=False)
    with factory() as session:
        yield session


def add_user(db: Session, user_id: int, nickname: str, role: str = "USER") -> User:
    now = utc_now()
    user = User(id=user_id, email=f"{nickname}@example.com", password_hash="unused", nickname=nickname, role=role, active=True, terms_agreed_at=now, privacy_agreed_at=now, created_at=now, updated_at=now)
    db.add(user); db.commit(); return user


def add_ranked_stat(db: Session, user: User, *, score: str, attempts: int, elapsed: int, achieved: datetime, difficulty: str = "EASY") -> DaruGameStat:
    record = DaruGamePlayRecord(user_id=user.id, difficulty=difficulty, detection_power=Decimal(score), attempts=attempts, elapsed_seconds=elapsed, max_combo=5, hints_used=0, earned_daru_points=0, completed=True, within_time_limit=True, score_version=2, achieved_at=achieved, created_at=achieved)
    db.add(record); db.flush()
    stat = DaruGameStat(user_id=user.id, difficulty=difficulty, best_detection_power=Decimal(score), score_version=2, best_attempts=attempts, best_elapsed_seconds=elapsed, best_combo=5, best_hints_used=0, total_daru_points=0, play_count=1, best_achieved_at=achieved, ranking_record_id=record.id, created_at=achieved, updated_at=achieved)
    db.add(stat)
    return stat


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
        "columns": 10,
        "supported_columns": (4, 5, 6, 7, 8, 9, 10),
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


@pytest.mark.parametrize(
    ("difficulty", "card_count", "pair_count"),
    [("EASY", 20, 10), ("NORMAL", 32, 16), ("HARD", 40, 20)],
)
def test_constrained_shuffle_avoids_adjacent_pairs_across_one_hundred_decks(difficulty: str, card_count: int, pair_count: int) -> None:
    supported_columns = DIFFICULTY_CONFIG[difficulty]["supported_columns"]
    decks = [create_shuffled_deck(difficulty, random.Random(seed)) for seed in range(100)]
    assert all(len(deck) == card_count for deck in decks)
    assert all(len(set(deck)) == pair_count for deck in decks)
    assert all(all(deck.count(pair_id) == 2 for pair_id in set(deck)) for deck in decks)
    assert all(not has_adjacent_pair_for_columns(deck, supported_columns) for deck in decks)
    assert len({tuple(deck) for deck in decks}) > 90


@pytest.mark.parametrize("difficulty", ["EASY", "NORMAL", "HARD"])
def test_constrained_shuffle_fallback_is_randomized_and_valid(difficulty: str) -> None:
    supported_columns = DIFFICULTY_CONFIG[difficulty]["supported_columns"]
    desktop_columns = DIFFICULTY_CONFIG[difficulty]["columns"]
    pair_ids = select_card_ids(difficulty, random.Random(0))
    deck = [pair_id for pair_id in pair_ids for _copy in range(2)]
    results = [constrained_shuffle(deck, supported_columns, random.Random(seed), max_attempts=0) for seed in range(20)]
    for result in results:
        assert sorted(result) == sorted(deck)
        assert not has_adjacent_pair_for_columns(result, supported_columns)
        assert result[:len(result) // 2] != result[len(result) // 2:]
        positions = {pair_id: [index for index, value in enumerate(result) if value == pair_id] for pair_id in pair_ids}
        assert not all(second - first == desktop_columns * 2 for first, second in positions.values())
    assert len({tuple(result) for result in results}) > 15


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


def legacy_hard_deck() -> list[str]:
    return [card_id for card_id in [*NORMAL_CARD_IDS, *HARD_ADDITIONAL_CARD_IDS] for _copy in range(2)]


def assert_outdated_deck(response) -> None:
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "OUTDATED_DECK_CONFIGURATION",
        "message": "Game run uses an outdated deck configuration",
    }


def test_legacy_hard_created_run_is_rejected_by_preview_state_and_start(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "HARD", age_seconds=0)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    run.deck_state = legacy_hard_deck(); db.commit()

    assert_outdated_deck(client.get(f"/api/daru-game/runs/{run_id}/preview"))
    assert_outdated_deck(client.get(f"/api/daru-game/runs/{run_id}/state"))
    assert_outdated_deck(client.post(f"/api/daru-game/runs/{run_id}/start", json=action_json()))


def test_legacy_hard_playing_run_is_rejected_by_flip_hint_and_complete(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "HARD", age_seconds=0)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    run.deck_state = legacy_hard_deck()
    run.play_started_at = utc_now() - timedelta(seconds=200)
    run.matched_pairs = 20
    db.commit()

    assert_outdated_deck(client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0)))
    assert_outdated_deck(client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json()))
    assert_outdated_deck(client.post("/api/daru-game/results", json=action_json(run_id=run_id)))


def test_current_length_with_invalid_pair_distribution_is_rejected(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "HARD", age_seconds=0)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    run.deck_state = [*run.deck_state[:-2], run.deck_state[0], run.deck_state[0]]
    db.commit()

    assert len(run.deck_state) == 40
    assert_outdated_deck(client.get(f"/api/daru-game/runs/{run_id}/state"))


def test_consumed_legacy_hard_run_state_remains_available(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "HARD", age_seconds=0)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    run.deck_state = legacy_hard_deck()
    run.play_started_at = utc_now() - timedelta(seconds=240)
    run.consumed_at = utc_now()
    db.commit()

    response = client.get(f"/api/daru-game/runs/{run_id}/state")
    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"
    assert response.json()["positions"] == list(range(48))


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
    payload = response.json()
    assert payload["metrics"]["completed"] is True
    assert payload["metrics"]["within_time_limit"] is False
    assert payload["metrics"]["speed_score"] == 0.0
    assert payload["metrics"]["memory_accuracy"] == 100.0
    assert payload["metrics"]["combo_score"] == 100.0
    assert payload["metrics"]["hint_score"] == 100.0
    assert payload["metrics"]["detection_power"] == 75.0
    assert payload["is_new_best"] is True
    assert payload["leaderboard_rank"] == 1


def test_result_immediately_ranks_first_completed_record_with_autoflush_disabled(client: TestClient, db: Session) -> None:
    assert db.autoflush is False
    competitor = add_user(db, 2, "competitor")
    add_ranked_stat(db, competitor, score="80.0", attempts=15, elapsed=60, achieved=utc_now())
    db.commit()
    run_id, _run = start_authoritative_run(client, db, elapsed_seconds=1)
    complete_pairs(client, run_id, 10)

    result = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    leaderboard = client.get("/api/daru-game/leaderboard?difficulty=EASY")

    assert result.status_code == leaderboard.status_code == 200
    assert result.json()["leaderboard_rank"] == 1
    assert leaderboard.json()["my_entry"]["rank"] == 1


def test_result_immediately_uses_lower_latest_record_rank_with_autoflush_disabled(client: TestClient, db: Session) -> None:
    assert db.autoflush is False
    now = utc_now()
    for index, score in enumerate(("95.0", "94.0", "90.0", "85.0", "80.0"), 2):
        competitor = add_user(db, index, f"competitor-{index}")
        add_ranked_stat(db, competitor, score=score, attempts=10 + index, elapsed=40 + index, achieved=now + timedelta(seconds=index))
    db.commit()
    best_run_id, _run = start_authoritative_run(client, db, elapsed_seconds=1)
    complete_pairs(client, best_run_id, 10)
    assert client.post("/api/daru-game/results", json=action_json(run_id=best_run_id)).json()["leaderboard_rank"] == 1
    latest_run_id, _run = start_authoritative_run(client, db, elapsed_seconds=121)
    complete_pairs(client, latest_run_id, 10)

    result = client.post("/api/daru-game/results", json=action_json(run_id=latest_run_id))
    leaderboard = client.get("/api/daru-game/leaderboard?difficulty=EASY")
    history = client.get("/api/daru-game/history?difficulty=EASY&page=1&page_size=5")
    stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == 1, DaruGameStat.difficulty == "EASY"))

    assert result.status_code == leaderboard.status_code == history.status_code == 200
    assert result.json()["metrics"]["detection_power"] == 75.0
    assert result.json()["leaderboard_rank"] == leaderboard.json()["my_entry"]["rank"] == 6
    assert leaderboard.json()["my_entry"]["detection_power"] == 75.0
    assert leaderboard.json()["my_best"]["best_detection_power"] == 100.0
    assert [item["detection_power"] for item in history.json()["items"]] == [75.0, 100.0]
    assert history.json()["items"][0]["is_ranking_record"] is True
    assert history.json()["items"][1]["is_best"] is True
    assert stat is not None and stat.ranking_record_id == history.json()["items"][0]["id"]


def test_hard_server_timeout_uses_new_280_second_limit(client: TestClient, db: Session) -> None:
    run_id, _run = start_authoritative_run(client, db, "HARD", elapsed_seconds=281)
    complete_pairs(client, run_id, 20)
    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))
    assert response.status_code == 200
    assert response.json()["metrics"]["within_time_limit"] is False
    assert response.json()["metrics"]["speed_score"] == 0.0
    assert response.json()["leaderboard_rank"] == 1


@pytest.mark.parametrize(("existing_score", "expected_score", "expected_new_best"), [("70.0", 75.0, True), ("90.0", 90.0, False)])
def test_overtime_completion_compares_against_existing_best(client: TestClient, db: Session, existing_score: str, expected_score: float, expected_new_best: bool) -> None:
    now = utc_now()
    db.add(DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=Decimal(existing_score), score_version=2, best_attempts=20, best_elapsed_seconds=100, best_combo=5, best_hints_used=0, total_daru_points=0, play_count=1, best_achieved_at=now, created_at=now, updated_at=now))
    db.commit()
    run_id, _run = start_authoritative_run(client, db, elapsed_seconds=121)
    complete_pairs(client, run_id, 10)

    response = client.post("/api/daru-game/results", json=action_json(run_id=run_id))

    assert response.status_code == 200
    assert response.json()["metrics"]["detection_power"] == 75.0
    assert response.json()["record"]["best_detection_power"] == expected_score
    assert response.json()["is_new_best"] is expected_new_best


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
    for user, score, attempts, elapsed, achieved in rows: add_ranked_stat(db, user, score=score, attempts=attempts, elapsed=elapsed, achieved=achieved)
    db.commit()
    assert [nickname for _stat, _record, nickname in db.execute(ranking_query("EASY")).all()] == ["first", "time", "attempt", "score", "lower"]


def test_leaderboard_returns_top_three_paged_general_rows_and_my_rank(client: TestClient, db: Session) -> None:
    now = utc_now()
    users = [add_user(db, user_id, f"rank-{user_id}") for user_id in range(2, 13)]
    users.append(db.get(User, 1))
    for index, user in enumerate(users):
        assert user is not None
        add_ranked_stat(db, user, score=str(99 - index), attempts=10 + index, elapsed=40 + index, achieved=now + timedelta(seconds=index))
    db.commit()

    response = client.get("/api/daru-game/leaderboard?difficulty=EASY&page=2&page_size=5")
    assert response.status_code == 200
    payload = response.json()
    assert [entry["rank"] for entry in payload["top_entries"]] == [1, 2, 3]
    assert [entry["rank"] for entry in payload["entries"]] == [9, 10, 11, 12]
    assert payload["my_entry"]["rank"] == 12
    assert payload["next_rank_score"] == 89.0
    assert payload["total"] == 12
    assert payload["page"] == 2
    assert payload["page_size"] == 5
    assert payload["total_pages"] == 2


def history_record(db: Session, *, user_id: int = 1, score: str, achieved: datetime, completed: bool = True) -> DaruGamePlayRecord:
    record = DaruGamePlayRecord(user_id=user_id, difficulty="EASY", detection_power=Decimal(score), attempts=10, elapsed_seconds=60, max_combo=5, hints_used=0, earned_daru_points=100, completed=completed, within_time_limit=completed, score_version=2, achieved_at=achieved, created_at=achieved)
    db.add(record); db.flush(); return record


def test_history_latest_clear_updates_ranking_but_not_best_and_partial_updates_neither(client: TestClient, db: Session) -> None:
    now = utc_now()
    best = history_record(db, score="95.0", achieved=now)
    latest = history_record(db, score="70.0", achieved=now + timedelta(seconds=1))
    partial = history_record(db, score="50.0", achieved=now + timedelta(seconds=2), completed=False)
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=best.attempts, best_elapsed_seconds=best.elapsed_seconds, best_combo=best.max_combo, best_hints_used=best.hints_used, total_daru_points=300, play_count=3, best_achieved_at=best.achieved_at, ranking_record_id=latest.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()
    leaderboard_payload = client.get("/api/daru-game/leaderboard?difficulty=EASY").json()
    assert leaderboard_payload["my_entry"]["detection_power"] == 70.0
    assert leaderboard_payload["my_best"]["best_detection_power"] == 95.0
    items = client.get("/api/daru-game/history?difficulty=EASY&page=1&page_size=5").json()["items"]
    assert [item["id"] for item in items] == [partial.id, latest.id, best.id]
    assert items[0]["completed"] is False
    assert items[1]["is_ranking_record"] is True
    assert items[2]["is_best"] is True


@pytest.mark.parametrize(
    ("pointer_version", "pointer_deleted", "other_count", "expected_total", "expected_protected", "expected_deletable"),
    [
        (2, False, 5, 6, 1, 5),
        (1, False, 5, 6, 1, 5),
        (2, True, 5, 5, 0, 5),
        (2, False, 0, 1, 1, 0),
    ],
    ids=["current-ranking", "old-version-ranking", "deleted-ranking", "ranking-only"],
)
def test_history_management_metadata_matches_active_ranking_protection(
    client: TestClient,
    db: Session,
    pointer_version: int,
    pointer_deleted: bool,
    other_count: int,
    expected_total: int,
    expected_protected: int,
    expected_deletable: int,
) -> None:
    now = utc_now()
    pointer = history_record(db, score="90.0", achieved=now)
    pointer.score_version = pointer_version
    if pointer_deleted:
        pointer.deleted_at = now
    others = [history_record(db, score=str(80 - index), achieved=now + timedelta(seconds=index + 1)) for index in range(other_count)]
    best = others[0] if others else pointer
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=best.attempts, best_elapsed_seconds=best.elapsed_seconds, best_combo=best.max_combo, best_hints_used=best.hints_used, total_daru_points=600, play_count=6, best_achieved_at=best.achieved_at, ranking_record_id=pointer.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    payload = client.get("/api/daru-game/history?difficulty=EASY&page=1&page_size=5").json()

    assert payload["total"] == expected_total
    assert payload["protected_count"] == expected_protected
    assert payload["deletable_count"] == expected_deletable
    if pointer_version == 1 and not pointer_deleted:
        assert client.get("/api/daru-game/leaderboard?difficulty=EASY").json()["my_entry"] is None


def test_history_metadata_identifies_active_deletable_best(client: TestClient, db: Session) -> None:
    now = utc_now()
    best = history_record(db, score="95.0", achieved=now)
    ranking = history_record(db, score="80.0", achieved=now + timedelta(seconds=1))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=best.attempts, best_elapsed_seconds=best.elapsed_seconds, best_combo=best.max_combo, best_hints_used=best.hints_used, total_daru_points=200, play_count=2, best_achieved_at=best.achieved_at, ranking_record_id=ranking.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    payload = client.get("/api/daru-game/history?difficulty=EASY").json()

    assert payload["deletable_best_record_id"] == best.id
    assert payload["has_deletable_best"] is True


def test_history_metadata_excludes_ranking_protected_best(client: TestClient, db: Session) -> None:
    now = utc_now()
    best = history_record(db, score="95.0", achieved=now)
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=best.attempts, best_elapsed_seconds=best.elapsed_seconds, best_combo=best.max_combo, best_hints_used=best.hints_used, total_daru_points=100, play_count=1, best_achieved_at=best.achieved_at, ranking_record_id=best.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    payload = client.get("/api/daru-game/history?difficulty=EASY").json()

    assert payload["deletable_best_record_id"] is None
    assert payload["has_deletable_best"] is False


def test_history_metadata_ignores_old_score_version_best(client: TestClient, db: Session) -> None:
    old_best = history_record(db, score="99.0", achieved=utc_now())
    old_best.score_version = 1
    db.commit()

    payload = client.get("/api/daru-game/history?difficulty=EASY").json()

    assert payload["deletable_best_record_id"] is None
    assert payload["has_deletable_best"] is False


def test_history_metadata_uses_active_fallback_after_previous_best_deleted(client: TestClient, db: Session) -> None:
    now = utc_now()
    deleted_best = history_record(db, score="95.0", achieved=now)
    deleted_best.deleted_at = now + timedelta(seconds=1)
    active_best = history_record(db, score="82.0", achieved=now + timedelta(seconds=2))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=active_best.detection_power, score_version=2, best_attempts=active_best.attempts, best_elapsed_seconds=active_best.elapsed_seconds, best_combo=active_best.max_combo, best_hints_used=active_best.hints_used, total_daru_points=200, play_count=2, best_achieved_at=active_best.achieved_at, ranking_record_id=None, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    payload = client.get("/api/daru-game/history?difficulty=EASY").json()

    assert payload["deletable_best_record_id"] == active_best.id
    assert payload["has_deletable_best"] is True


def test_deleting_current_ranking_record_returns_conflict_and_preserves_state(client: TestClient, db: Session) -> None:
    now = utc_now(); best = history_record(db, score="95.0", achieved=now); ranking = history_record(db, score="70.0", achieved=now + timedelta(seconds=1))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=10, best_elapsed_seconds=60, best_combo=5, best_hints_used=0, total_daru_points=200, play_count=2, best_achieved_at=best.achieved_at, ranking_record_id=ranking.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()
    response = client.delete(f"/api/daru-game/history/{ranking.id}")
    assert response.status_code == 409
    assert response.json() == {"detail": "현재 랭킹에 반영 중인 기록은 삭제할 수 없습니다."}
    db.refresh(stat); db.refresh(ranking)
    assert stat.ranking_record_id == ranking.id
    assert stat.best_detection_power == Decimal("95.0")
    assert ranking.deleted_at is None
    assert client.get("/api/daru-game/leaderboard?difficulty=EASY").json()["my_entry"] is not None


def test_deleting_best_recomputes_best_while_delete_all_preserves_progress(db: Session) -> None:
    now = utc_now(); best = history_record(db, score="95.0", achieved=now); second = history_record(db, score="82.0", achieved=now + timedelta(seconds=1)); ranking = history_record(db, score="70.0", achieved=now + timedelta(seconds=2))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=10, best_elapsed_seconds=60, best_combo=5, best_hints_used=0, total_daru_points=777, play_count=9, best_achieved_at=best.achieved_at, ranking_record_id=ranking.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()
    assert soft_delete_play_record(db, user_id=1, record_id=best.id) is not None
    db.refresh(stat); assert stat.best_detection_power == Decimal("82.0"); assert stat.ranking_record_id == ranking.id
    assert soft_delete_all_play_records(db, user_id=1) == 1
    db.refresh(stat); assert stat.best_detection_power == Decimal("70.0"); assert stat.ranking_record_id == ranking.id
    assert stat.total_daru_points == 777; assert stat.play_count == 9


def test_deleting_current_version_best_never_revives_an_old_score_version(db: Session) -> None:
    now = utc_now()
    old_best = history_record(db, score="99.0", achieved=now)
    old_best.score_version = 1
    current_best = history_record(db, score="90.0", achieved=now + timedelta(seconds=1))
    current_second = history_record(db, score="80.0", achieved=now + timedelta(seconds=2))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=current_best.detection_power, score_version=2, best_attempts=current_best.attempts, best_elapsed_seconds=current_best.elapsed_seconds, best_combo=current_best.max_combo, best_hints_used=current_best.hints_used, total_daru_points=777, play_count=9, best_achieved_at=current_best.achieved_at, ranking_record_id=current_second.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    assert soft_delete_play_record(db, user_id=1, record_id=current_best.id) is not None

    db.refresh(stat)
    assert stat.best_detection_power == Decimal("80.0")
    assert stat.best_achieved_at == current_second.achieved_at.replace(tzinfo=None)
    assert stat.ranking_record_id == current_second.id
    assert stat.total_daru_points == 777 and stat.play_count == 9


def test_deleting_only_current_version_best_leaves_best_empty(db: Session) -> None:
    now = utc_now()
    old_best = history_record(db, score="99.0", achieved=now)
    old_best.score_version = 1
    current_best = history_record(db, score="90.0", achieved=now + timedelta(seconds=1))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=current_best.detection_power, score_version=2, best_attempts=current_best.attempts, best_elapsed_seconds=current_best.elapsed_seconds, best_combo=current_best.max_combo, best_hints_used=current_best.hints_used, total_daru_points=777, play_count=9, best_achieved_at=current_best.achieved_at, ranking_record_id=None, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    assert soft_delete_play_record(db, user_id=1, record_id=current_best.id) is not None

    db.refresh(stat)
    assert stat.best_detection_power == Decimal("0.0")
    assert stat.best_attempts is None
    assert stat.best_elapsed_seconds is None
    assert stat.best_combo == 0
    assert stat.best_hints_used is None
    assert stat.best_achieved_at is None
    assert stat.ranking_record_id is None
    assert stat.total_daru_points == 777 and stat.play_count == 9


def test_restore_recomputes_best_but_preserves_ranking_pointer(client: TestClient, db: Session) -> None:
    now = utc_now()
    best = history_record(db, score="95.0", achieved=now)
    latest = history_record(db, score="70.0", achieved=now + timedelta(seconds=1))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=best.attempts, best_elapsed_seconds=best.elapsed_seconds, best_combo=best.max_combo, best_hints_used=best.hints_used, total_daru_points=200, play_count=2, best_achieved_at=best.achieved_at, ranking_record_id=latest.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    latest.deleted_at = now + timedelta(seconds=2)
    db.commit()
    db.refresh(stat); assert stat.ranking_record_id == latest.id
    assert client.post(f"/api/daru-game/history/{latest.id}/restore").status_code == 204
    db.refresh(stat); db.refresh(latest)
    assert latest.deleted_at is None
    assert stat.ranking_record_id == latest.id
    assert stat.best_detection_power == Decimal("95.0")

    assert client.delete(f"/api/daru-game/history/{best.id}").status_code == 204
    db.refresh(stat); assert stat.best_detection_power == Decimal("70.0")
    assert client.post(f"/api/daru-game/history/{best.id}/restore").status_code == 204
    db.refresh(stat)
    assert stat.best_detection_power == Decimal("95.0")
    assert client.post(f"/api/daru-game/history/{best.id}/restore").status_code == 404


def test_restore_old_ranking_record_does_not_replace_a_new_game_pointer(client: TestClient, db: Session) -> None:
    now = utc_now()
    best = history_record(db, score="95.0", achieved=now)
    old_ranking = history_record(db, score="70.0", achieved=now + timedelta(seconds=1))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=best.attempts, best_elapsed_seconds=best.elapsed_seconds, best_combo=best.max_combo, best_hints_used=best.hints_used, total_daru_points=200, play_count=2, best_achieved_at=best.achieved_at, ranking_record_id=old_ranking.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()
    old_ranking.deleted_at = now + timedelta(seconds=2)
    db.commit()
    new_ranking = history_record(db, score="82.0", achieved=now + timedelta(seconds=2))
    stat.ranking_record_id = new_ranking.id
    db.commit()

    assert client.post(f"/api/daru-game/history/{old_ranking.id}/restore").status_code == 204
    db.refresh(stat)
    assert stat.ranking_record_id == new_ranking.id
    assert stat.best_detection_power == Decimal("95.0")


def test_history_paginates_five_five_two_and_rejects_foreign_delete(client: TestClient, db: Session) -> None:
    now = utc_now()
    for index in range(12): history_record(db, score=str(60 + index), achieved=now + timedelta(seconds=index))
    other = add_user(db, 2, "other"); foreign = history_record(db, user_id=other.id, score="99.0", achieved=now)
    db.commit()
    pages = [client.get(f"/api/daru-game/history?difficulty=EASY&page={page}&page_size=5").json() for page in (1, 2, 3)]
    assert [len(payload["items"]) for payload in pages] == [5, 5, 2]
    assert all(payload["total_pages"] == 3 for payload in pages)
    assert client.delete(f"/api/daru-game/history/{foreign.id}").status_code == 404


def test_batch_history_delete_is_atomic_and_rejects_foreign_records(client: TestClient, db: Session) -> None:
    now = utc_now()
    mine = [history_record(db, score=str(90 - index), achieved=now + timedelta(seconds=index)) for index in range(2)]
    other = add_user(db, 2, "batch-other")
    foreign = history_record(db, user_id=other.id, score="99.0", achieved=now)
    db.commit()

    response = client.post("/api/daru-game/history/delete", json={"record_ids": [mine[0].id, foreign.id]})

    assert response.status_code == 404
    db.expire_all()
    assert all(db.get(DaruGamePlayRecord, record.id).deleted_at is None for record in [*mine, foreign])


def test_batch_history_delete_protects_ranking_and_recomputes_best(client: TestClient, db: Session) -> None:
    now = utc_now()
    best = history_record(db, score="95.0", achieved=now)
    second = history_record(db, score="82.0", achieved=now + timedelta(seconds=1))
    ranking = history_record(db, score="70.0", achieved=now + timedelta(seconds=2))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=best.detection_power, score_version=2, best_attempts=10, best_elapsed_seconds=60, best_combo=5, best_hints_used=0, total_daru_points=300, play_count=3, best_achieved_at=best.achieved_at, ranking_record_id=ranking.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    response = client.post("/api/daru-game/history/delete", json={"record_ids": [best.id, ranking.id]})

    assert response.status_code == 409
    assert response.json() == {"detail": "현재 랭킹에 반영 중인 기록은 삭제할 수 없습니다."}
    db.refresh(best); db.refresh(ranking)
    assert best.deleted_at is None and ranking.deleted_at is None

    response = client.post("/api/daru-game/history/delete", json={"record_ids": [best.id]})
    assert response.status_code == 200 and response.json() == {"deleted_count": 1}
    db.refresh(stat)
    assert stat.best_detection_power == Decimal("82.0")
    assert stat.ranking_record_id == ranking.id
    assert stat.total_daru_points == 300 and stat.play_count == 3


def test_batch_history_delete_supports_entire_difficulty_with_exclusions(client: TestClient, db: Session) -> None:
    now = utc_now()
    easy = [history_record(db, score=str(80 + index), achieved=now + timedelta(seconds=index)) for index in range(7)]
    normal = history_record(db, score="88.0", achieved=now, completed=True)
    normal.difficulty = "NORMAL"
    db.commit()

    response = client.post("/api/daru-game/history/delete", json={"difficulty": "EASY", "exclude_record_ids": [easy[-1].id]})

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 6}
    db.expire_all()
    assert db.get(DaruGamePlayRecord, easy[-1].id).deleted_at is None
    assert db.get(DaruGamePlayRecord, normal.id).deleted_at is None
    assert all(db.get(DaruGamePlayRecord, record.id).deleted_at is not None for record in easy[:-1])


def test_all_history_cleanup_returns_actual_count_and_preserves_each_ranking_record(client: TestClient, db: Session) -> None:
    now = utc_now()
    easy_ranking = history_record(db, score="90.0", achieved=now)
    easy_other = history_record(db, score="80.0", achieved=now + timedelta(seconds=1))
    normal_ranking = history_record(db, score="85.0", achieved=now)
    normal_ranking.difficulty = "NORMAL"
    normal_other = history_record(db, score="75.0", achieved=now + timedelta(seconds=1))
    normal_other.difficulty = "NORMAL"
    db.flush()
    db.add_all([
        DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=easy_ranking.detection_power, score_version=2, best_attempts=easy_ranking.attempts, best_elapsed_seconds=easy_ranking.elapsed_seconds, best_combo=easy_ranking.max_combo, best_hints_used=easy_ranking.hints_used, total_daru_points=400, play_count=4, best_achieved_at=easy_ranking.achieved_at, ranking_record_id=easy_ranking.id, created_at=now, updated_at=now),
        DaruGameStat(user_id=1, difficulty="NORMAL", best_detection_power=normal_ranking.detection_power, score_version=2, best_attempts=normal_ranking.attempts, best_elapsed_seconds=normal_ranking.elapsed_seconds, best_combo=normal_ranking.max_combo, best_hints_used=normal_ranking.hints_used, total_daru_points=300, play_count=3, best_achieved_at=normal_ranking.achieved_at, ranking_record_id=normal_ranking.id, created_at=now, updated_at=now),
    ])
    db.commit()

    response = client.delete("/api/daru-game/history")

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 2}
    db.expire_all()
    assert db.get(DaruGamePlayRecord, easy_ranking.id).deleted_at is None
    assert db.get(DaruGamePlayRecord, normal_ranking.id).deleted_at is None
    assert db.get(DaruGamePlayRecord, easy_other.id).deleted_at is not None
    assert db.get(DaruGamePlayRecord, normal_other.id).deleted_at is not None


def test_batch_history_delete_requires_authentication(client: TestClient) -> None:
    app.dependency_overrides.pop(get_current_user)
    assert client.post("/api/daru-game/history/delete", json={"record_ids": [1]}).status_code == 401


def test_trash_paginates_by_latest_deletion_and_corrects_last_page(client: TestClient, db: Session) -> None:
    now = utc_now()
    records = [history_record(db, score=str(60 + index), achieved=now + timedelta(seconds=index)) for index in range(12)]
    db.commit()
    for index, record in enumerate(records):
        record.deleted_at = now + timedelta(minutes=index)
    db.commit()

    pages = [client.get(f"/api/daru-game/history/trash?difficulty=EASY&page={page}&page_size=5").json() for page in (1, 2, 3)]
    assert [len(payload["items"]) for payload in pages] == [5, 5, 2]
    assert all(payload["total_pages"] == 3 for payload in pages)
    assert pages[0]["items"][0]["id"] == records[-1].id
    assert pages[0]["items"][0]["deleted_at"] is not None

    for item in pages[2]["items"]:
        assert client.delete(f"/api/daru-game/history/{item['id']}/permanent").status_code == 204
    corrected = client.get("/api/daru-game/history/trash?difficulty=EASY&page=3&page_size=5").json()
    assert corrected["page"] == 2 and corrected["total_pages"] == 2


def test_permanent_delete_rejects_owned_trashed_ranking_record(client: TestClient, db: Session) -> None:
    now = utc_now()
    record = history_record(db, score="90.0", achieved=now)
    record.deleted_at = now
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=Decimal("0.0"), score_version=2, best_attempts=None, best_elapsed_seconds=None, best_combo=0, best_hints_used=None, total_daru_points=100, play_count=1, best_achieved_at=None, ranking_record_id=record.id, created_at=now, updated_at=now)
    other = add_user(db, 2, "trash-other")
    foreign = history_record(db, user_id=other.id, score="88.0", achieved=now)
    foreign.deleted_at = now
    active = history_record(db, score="77.0", achieved=now)
    db.add(stat); db.commit()

    trash_ids = {item["id"] for item in client.get("/api/daru-game/history/trash?difficulty=EASY").json()["items"]}
    assert foreign.id not in trash_ids
    assert client.post(f"/api/daru-game/history/{foreign.id}/restore").status_code == 404
    assert client.delete(f"/api/daru-game/history/{foreign.id}/permanent").status_code == 404
    assert client.delete(f"/api/daru-game/history/{active.id}/permanent").status_code == 404
    response = client.delete(f"/api/daru-game/history/{record.id}/permanent")
    assert response.status_code == 409
    assert response.json() == {"detail": "현재 랭킹에 반영 중인 기록은 삭제할 수 없습니다."}
    db.expire_all()
    assert db.get(DaruGamePlayRecord, record.id) is not None
    assert db.get(DaruGameStat, stat.id).ranking_record_id == record.id
    assert client.post(f"/api/daru-game/history/{record.id}/restore").status_code == 204


def test_empty_trash_is_difficulty_scoped_and_preserves_active_records(client: TestClient, db: Session) -> None:
    now = utc_now()
    easy_deleted = [history_record(db, score=str(80 + index), achieved=now + timedelta(seconds=index)) for index in range(3)]
    for record in easy_deleted:
        record.deleted_at = now
    normal_deleted = history_record(db, score="75.0", achieved=now)
    normal_deleted.difficulty = "NORMAL"; normal_deleted.deleted_at = now
    active = history_record(db, score="70.0", achieved=now)
    db.commit()

    response = client.delete("/api/daru-game/history/trash?difficulty=EASY")
    assert response.status_code == 200 and response.json() == {"deleted_count": 3}
    db.expire_all()
    assert all(db.get(DaruGamePlayRecord, record.id) is None for record in easy_deleted)
    assert db.get(DaruGamePlayRecord, normal_deleted.id) is not None
    assert db.get(DaruGamePlayRecord, active.id) is not None


def test_previous_ranking_record_becomes_deletable_after_pointer_changes(client: TestClient, db: Session) -> None:
    now = utc_now()
    previous = history_record(db, score="90.0", achieved=now)
    current = history_record(db, score="80.0", achieved=now + timedelta(seconds=1))
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=previous.detection_power, score_version=2, best_attempts=previous.attempts, best_elapsed_seconds=previous.elapsed_seconds, best_combo=previous.max_combo, best_hints_used=previous.hints_used, total_daru_points=200, play_count=2, best_achieved_at=previous.achieved_at, ranking_record_id=current.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    assert client.delete(f"/api/daru-game/history/{previous.id}").status_code == 204
    db.refresh(previous); db.refresh(stat)
    assert previous.deleted_at is not None
    assert stat.ranking_record_id == current.id


def test_empty_trash_excludes_legacy_trashed_ranking_record(client: TestClient, db: Session) -> None:
    now = utc_now()
    protected = history_record(db, score="90.0", achieved=now)
    protected.deleted_at = now
    deletable = history_record(db, score="80.0", achieved=now + timedelta(seconds=1))
    deletable.deleted_at = now
    stat = DaruGameStat(user_id=1, difficulty="EASY", best_detection_power=Decimal("0.0"), score_version=2, best_attempts=None, best_elapsed_seconds=None, best_combo=0, best_hints_used=None, total_daru_points=200, play_count=2, best_achieved_at=None, ranking_record_id=protected.id, created_at=now, updated_at=now)
    db.add(stat); db.commit()

    response = client.delete("/api/daru-game/history/trash?difficulty=EASY")

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 1}
    db.expire_all()
    assert db.get(DaruGamePlayRecord, protected.id) is not None
    assert db.get(DaruGamePlayRecord, deletable.id) is None
    assert db.get(DaruGameStat, stat.id).ranking_record_id == protected.id


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
    assert f"{settings.AUTH_COOKIE_NAME}=" in set_cookie
    assert f"Max-Age={settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60}" in set_cookie
    assert "HttpOnly" in set_cookie and "SameSite=lax" in set_cookie


def assert_expired_run(response) -> None:
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "RUN_EXPIRED", "message": "Game run has expired"}


def test_state_accepts_active_run_younger_than_max_age(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=24 * 60 * 60 - 60)
    assert client.get(f"/api/daru-game/runs/{run_id}/state").status_code == 200


def test_expiration_boundary_preserves_strict_max_age_comparison() -> None:
    started_at = datetime(2026, 1, 1, tzinfo=UTC)
    run = DaruGameRun(started_at=started_at)
    _ensure_not_expired(run, now=started_at + GAME_RUN_MAX_AGE)
    with pytest.raises(GameRunExpiredError, match="Game run has expired"):
        _ensure_not_expired(run, now=started_at + GAME_RUN_MAX_AGE + timedelta(microseconds=1))


def test_state_rejects_expired_active_run(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=24 * 60 * 60 + 1)
    assert_expired_run(client.get(f"/api/daru-game/runs/{run_id}/state"))


def test_expired_created_run_is_rejected_by_preview_and_start(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=24 * 60 * 60 + 1)
    assert_expired_run(client.get(f"/api/daru-game/runs/{run_id}/preview"))
    assert_expired_run(client.post(f"/api/daru-game/runs/{run_id}/start", json=action_json()))


def test_expired_playing_run_is_rejected_by_flip_hint_and_complete(client: TestClient, db: Session) -> None:
    run_id = create_run(client, db, "EASY", age_seconds=24 * 60 * 60 + 1)
    run = db.get(DaruGameRun, UUID(run_id)); assert run is not None
    run.play_started_at = utc_now() - timedelta(seconds=120)
    db.commit()
    assert_expired_run(client.post(f"/api/daru-game/runs/{run_id}/flip", json=action_json(position=0)))
    assert_expired_run(client.post(f"/api/daru-game/runs/{run_id}/hint", json=action_json()))
    assert_expired_run(client.post("/api/daru-game/results", json=action_json(run_id=run_id)))


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
