from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import secrets
from typing import Any, Callable, Sequence
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import DaruGamePlayRecord, DaruGameRun, DaruGameRunAction, DaruGameStat, User


DIFFICULTY_CONFIG = {
    "EASY": {"pairs": 10, "columns": 5, "supported_columns": (4, 5), "time_limit_seconds": 120, "speed_benchmark_seconds": 90, "combo_target": 5, "clear_bonus": 300, "preview_seconds": 5},
    "NORMAL": {"pairs": 16, "columns": 8, "supported_columns": (4, 5, 6, 7, 8), "time_limit_seconds": 210, "speed_benchmark_seconds": 150, "combo_target": 7, "clear_bonus": 500, "preview_seconds": 7},
    "HARD": {"pairs": 20, "columns": 10, "supported_columns": (4, 5, 6, 7, 8, 9, 10), "time_limit_seconds": 280, "speed_benchmark_seconds": 200, "combo_target": 8, "clear_bonus": 700, "preview_seconds": 8},
}
EASY_CARD_IDS = ["greeting", "excited", "heart", "sleeping", "search", "umbrella", "shoe", "backpack", "ball", "can"]
NORMAL_CARD_IDS = [*EASY_CARD_IDS, "thumbs-up", "sulky", "coastal-cleanup", "umbrella-found", "plastic-bag", "plastic-bottle"]
HARD_ADDITIONAL_CARD_IDS = ["shy", "splash", "branch-play", "plastic-sort", "shoe-found", "backpack-found", "proud", "styrofoam"]
CARD_IDS_BY_DIFFICULTY = {
    "EASY": EASY_CARD_IDS,
    "NORMAL": NORMAL_CARD_IDS,
}
GAME_RUN_MAX_AGE = timedelta(hours=24)
CURRENT_SCORE_VERSION = 2
SCORE_TENTH = Decimal("0.1")
RANKING_SCORE_QUANTUM = Decimal("0.0001")
DECK_SHUFFLE_MAX_ATTEMPTS = 80
RANKING_RECORD_DELETE_PROTECTED_MESSAGE = "현재 랭킹에 사용 중인 기록은 삭제할 수 없습니다."


class GameRunNotFoundError(ValueError):
    pass


class GameRunConflictError(ValueError):
    pass


class GameRunExpiredError(GameRunConflictError):
    pass


class OutdatedGameRunError(GameRunConflictError):
    pass


class ProtectedRankingRecordError(ValueError):
    pass


def select_card_ids(difficulty: str, randomizer: Any | None = None) -> list[str]:
    if difficulty != "HARD":
        return list(CARD_IDS_BY_DIFFICULTY[difficulty])
    hard_additional = list(HARD_ADDITIONAL_CARD_IDS)
    (randomizer or secrets.SystemRandom()).shuffle(hard_additional)
    return [*NORMAL_CARD_IDS, *hard_additional[:4]]


def has_adjacent_pair(deck: Sequence[str], columns: int) -> bool:
    first_positions: dict[str, int] = {}
    for index, pair_id in enumerate(deck):
        first_index = first_positions.get(pair_id)
        if first_index is None:
            first_positions[pair_id] = index
            continue
        first_row, first_column = divmod(first_index, columns)
        row, column = divmod(index, columns)
        if abs(first_row - row) <= 1 and abs(first_column - column) <= 1:
            return True
    return False


def has_adjacent_pair_for_columns(deck: Sequence[str], supported_columns: Sequence[int]) -> bool:
    return any(has_adjacent_pair(deck, columns) for columns in supported_columns)


def _positions_are_adjacent(first: int, second: int, columns: int) -> bool:
    first_row, first_column = divmod(first, columns)
    second_row, second_column = divmod(second, columns)
    return abs(first_row - second_row) <= 1 and abs(first_column - second_column) <= 1


def _randomized_position_pairs(card_count: int, supported_columns: Sequence[int], rng: Any) -> list[tuple[int, int]]:
    def pair_positions(available: list[int]) -> list[tuple[int, int]] | None:
        if not available:
            return []
        first_candidates = list(available)
        rng.shuffle(first_candidates)
        first = min(
            first_candidates,
            key=lambda position: sum(
                other != position and all(not _positions_are_adjacent(position, other, columns) for columns in supported_columns)
                for other in available
            ),
        )
        remaining = [position for position in available if position != first]
        second_candidates = [position for position in remaining if all(not _positions_are_adjacent(first, position, columns) for columns in supported_columns)]
        rng.shuffle(second_candidates)
        for second in second_candidates:
            rest = pair_positions([position for position in remaining if position != second])
            if rest is not None:
                return [(first, second), *rest]
        return None

    result = pair_positions(list(range(card_count)))
    if result is None:
        raise RuntimeError("Unable to construct a non-adjacent card layout")
    return result


def constrained_shuffle(deck: Sequence[str], supported_columns: Sequence[int], randomizer: Any | None = None, *, max_attempts: int = DECK_SHUFFLE_MAX_ATTEMPTS) -> list[str]:
    rng = randomizer or secrets.SystemRandom()
    for _attempt in range(max_attempts):
        candidate = list(deck)
        rng.shuffle(candidate)
        if not has_adjacent_pair_for_columns(candidate, supported_columns):
            return candidate

    pair_ids = list(dict.fromkeys(deck))
    rng.shuffle(pair_ids)
    positions = _randomized_position_pairs(len(deck), supported_columns, rng)
    result = [""] * len(deck)
    for pair_id, (first, second) in zip(pair_ids, positions, strict=True):
        result[first] = pair_id
        result[second] = pair_id
    return result


def create_shuffled_deck(difficulty: str, randomizer: Any | None = None) -> list[str]:
    rng = randomizer or secrets.SystemRandom()
    deck = [card_id for card_id in select_card_ids(difficulty, rng) for _copy in range(2)]
    return constrained_shuffle(deck, DIFFICULTY_CONFIG[difficulty]["supported_columns"], rng)


def create_game_run(db: Session, *, user_id: int, difficulty: str) -> DaruGameRun:
    now = utc_now()
    deck = create_shuffled_deck(difficulty)
    run = DaruGameRun(id=uuid4(), user_id=user_id, difficulty=difficulty, started_at=now, deck_state=deck, matched_positions=[])
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def game_run_lock_query(run_id: UUID):
    return select(DaruGameRun).where(DaruGameRun.id == run_id).with_for_update()


def _ensure_current_deck_shape(run: DaruGameRun) -> None:
    if run.consumed_at is not None:
        return
    expected_pairs = DIFFICULTY_CONFIG[run.difficulty]["pairs"]
    pair_counts = Counter(run.deck_state)
    if len(run.deck_state) != expected_pairs * 2 or len(pair_counts) != expected_pairs or any(count != 2 for count in pair_counts.values()):
        raise OutdatedGameRunError("Game run uses an outdated deck configuration")


def _locked_owned_run(db: Session, *, run_id: UUID, user_id: int) -> DaruGameRun:
    run = db.scalar(game_run_lock_query(run_id))
    if run is None or run.user_id != user_id:
        raise GameRunNotFoundError("Game run not found")

    _ensure_current_deck_shape(run)
    return run


def _ensure_not_expired(run: DaruGameRun, now: datetime | None = None) -> None:
    current = now or utc_now()
    started_at = run.started_at if run.started_at.tzinfo is not None else run.started_at.replace(tzinfo=UTC)
    if current - started_at < timedelta(0) or current - started_at > GAME_RUN_MAX_AGE:
        raise GameRunExpiredError("Game run has expired")


def request_fingerprint(action_type: str, payload: dict[str, object]) -> str:
    canonical = json.dumps({"action_type": action_type, "payload": payload}, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def perform_game_action(
    db: Session,
    *,
    run_id: UUID,
    user_id: int,
    action_id: UUID,
    action_type: str,
    request_payload: dict[str, object],
    handler: Callable[[DaruGameRun], dict[str, Any]],
) -> dict[str, Any]:
    run = _locked_owned_run(db, run_id=run_id, user_id=user_id)
    fingerprint = request_fingerprint(action_type, request_payload)
    receipt = db.scalar(select(DaruGameRunAction).where(DaruGameRunAction.run_id == run_id, DaruGameRunAction.action_id == action_id))
    if receipt is not None:
        if receipt.action_type != action_type or receipt.request_fingerprint != fingerprint:
            raise GameRunConflictError("Action id was already used for a different request")
        return dict(receipt.response_payload)
    _ensure_not_expired(run)
    if run.consumed_at is not None:
        raise GameRunConflictError("Game run has already been consumed")
    response_payload = handler(run)
    db.add(DaruGameRunAction(run_id=run.id, action_id=action_id, action_type=action_type, request_fingerprint=fingerprint, response_payload=response_payload, created_at=utc_now()))
    db.commit()
    return response_payload


def start_gameplay(run: DaruGameRun) -> dict[str, Any]:
    if run.play_started_at is not None:
        raise GameRunConflictError("Game run has already started")
    run.play_started_at = utc_now()
    return {"play_started_at": run.play_started_at.isoformat()}


def game_run_preview(db: Session, *, run_id: UUID, user_id: int) -> dict[str, Any]:
    run = _locked_owned_run(db, run_id=run_id, user_id=user_id)
    _ensure_not_expired(run)
    if run.consumed_at is not None:
        raise GameRunConflictError("Game run has already been consumed")
    if run.play_started_at is not None:
        raise GameRunConflictError("Game run has already started")
    return {"cards": [{"position": position, "card_id": card_id} for position, card_id in enumerate(run.deck_state)]}


def _require_started(run: DaruGameRun) -> None:
    if run.play_started_at is None:
        raise GameRunConflictError("Game run has not started")


def flip_card(run: DaruGameRun, *, position: int) -> dict[str, Any]:
    _require_started(run)
    if not 0 <= position < len(run.deck_state):
        raise ValueError("Invalid card position")
    matched_positions = list(run.matched_positions or [])
    if position in matched_positions or position == run.first_position:
        raise ValueError("Card position is already revealed")
    matched: bool | None = None
    points_awarded = 0
    if run.first_position is None:
        run.first_position = position
    else:
        first_position = run.first_position
        run.attempts += 1
        matched = run.deck_state[first_position] == run.deck_state[position]
        if matched:
            run.current_combo += 1
            run.max_combo = max(run.max_combo, run.current_combo)
            points_awarded = 100 + min(max(0, run.current_combo - 1) * 25, 100)
            run.earned_daru_points += points_awarded
            run.matched_pairs += 1
            run.matched_positions = [*matched_positions, first_position, position]
        else:
            run.current_combo = 0
        run.first_position = None
    return {
        "card": {"position": position, "card_id": run.deck_state[position]},
        "matched": matched,
        "matched_positions": list(run.matched_positions),
        "attempts": run.attempts,
        "matched_pairs": run.matched_pairs,
        "current_combo": run.current_combo,
        "max_combo": run.max_combo,
        "earned_daru_points": run.earned_daru_points,
        "points_awarded": points_awarded,
    }


def use_game_hint(run: DaruGameRun) -> dict[str, Any]:
    _require_started(run)
    if run.hints_used >= 2:
        raise GameRunConflictError("No hints remaining")
    if run.first_position is not None:
        raise GameRunConflictError("Cannot use a hint during an attempt")
    run.hints_used += 1
    return {
        "hints_used": run.hints_used,
        "hints_remaining": 2 - run.hints_used,
        "cards": [{"position": index, "card_id": card_id} for index, card_id in enumerate(run.deck_state)],
    }


def _round_to_tenth(value: Decimal) -> Decimal:
    return value.quantize(SCORE_TENTH, rounding=ROUND_HALF_UP)


def calculate_memory_accuracy(pair_count: int, attempts: int) -> Decimal:
    if attempts <= 0:
        return Decimal("0")
    extra_attempt_ratio = Decimal(attempts - pair_count) / Decimal(pair_count)
    return max(Decimal("0"), min(Decimal("100"), Decimal("100") - extra_attempt_ratio * Decimal("50")))


def calculate_hint_score(hints_used: int) -> Decimal:
    return max(Decimal("0"), min(Decimal("100"), Decimal("100") - Decimal(hints_used * 50)))


def _calculate_speed_score_decimal(elapsed_seconds: int, benchmark_seconds: int, time_limit_seconds: int, within_time_limit: bool = True) -> Decimal:
    if not within_time_limit or elapsed_seconds > time_limit_seconds:
        return Decimal("0")
    elapsed = Decimal(max(1, elapsed_seconds))
    benchmark = Decimal(benchmark_seconds)
    time_limit = Decimal(time_limit_seconds)
    half_benchmark = benchmark / Decimal("2")
    if elapsed <= half_benchmark:
        return Decimal("100")
    if elapsed <= benchmark:
        progress = (elapsed - half_benchmark) / half_benchmark
        return max(Decimal("0"), min(Decimal("100"), Decimal("100") - Decimal("20") * progress))
    overtime_ratio = (elapsed - benchmark) / (time_limit - benchmark)
    return max(Decimal("40"), min(Decimal("100"), Decimal("80") - Decimal("40") * overtime_ratio))


def calculate_speed_score(elapsed_seconds: int, benchmark_seconds: int, time_limit_seconds: int, within_time_limit: bool = True) -> float:
    return float(_calculate_speed_score_decimal(elapsed_seconds, benchmark_seconds, time_limit_seconds, within_time_limit))


def _calculate_weighted_score(difficulty: str, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, within_time_limit: bool = True) -> Decimal:
    config = DIFFICULTY_CONFIG[difficulty]
    memory = calculate_memory_accuracy(config["pairs"], attempts)
    speed = _calculate_speed_score_decimal(elapsed_seconds, config["speed_benchmark_seconds"], config["time_limit_seconds"], within_time_limit)
    combo = min(Decimal("1"), Decimal(max_combo) / Decimal(config["combo_target"])) * Decimal("100")
    hint = calculate_hint_score(hints_used)
    return max(Decimal("0"), min(Decimal("100"), memory * Decimal("0.50") + speed * Decimal("0.25") + combo * Decimal("0.15") + hint * Decimal("0.10")))


def calculate_detection_power(difficulty: str, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, within_time_limit: bool = True) -> Decimal:
    return _round_to_tenth(_calculate_weighted_score(difficulty, attempts, elapsed_seconds, max_combo, hints_used, within_time_limit))


def calculate_ranking_score(difficulty: str, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, within_time_limit: bool = True) -> Decimal:
    return _calculate_weighted_score(difficulty, attempts, elapsed_seconds, max_combo, hints_used, within_time_limit).quantize(RANKING_SCORE_QUANTUM, rounding=ROUND_HALF_UP)


def detection_metrics(difficulty: str, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, within_time_limit: bool) -> dict[str, Decimal]:
    config = DIFFICULTY_CONFIG[difficulty]
    return {
        "memory_accuracy": _round_to_tenth(calculate_memory_accuracy(config["pairs"], attempts)),
        "speed_score": _round_to_tenth(_calculate_speed_score_decimal(elapsed_seconds, config["speed_benchmark_seconds"], config["time_limit_seconds"], within_time_limit)),
        "combo_score": _round_to_tenth(min(Decimal("1"), Decimal(max_combo) / Decimal(config["combo_target"])) * Decimal("100")),
        "hint_score": _round_to_tenth(calculate_hint_score(hints_used)),
        "detection_power": calculate_detection_power(difficulty, attempts, elapsed_seconds, max_combo, hints_used, within_time_limit),
    }


def rank_for(power: Decimal | float | int) -> str:
    if power >= 80: return "S"
    if power >= 65: return "A"
    if power >= 50: return "B"
    return "C"


def is_better(power: Decimal, attempts: int, elapsed: int, current: DaruGameStat) -> bool:
    if current.score_version != CURRENT_SCORE_VERSION or current.best_attempts is None:
        return True
    current_key = (-current.best_detection_power, current.best_attempts, current.best_elapsed_seconds or 2**31)
    candidate_key = (-power, attempts, elapsed)
    return candidate_key < current_key


def _apply_result(stat: DaruGameStat, *, eligible: bool, power: Decimal, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, earned_points: int, now: datetime) -> bool:
    improved = eligible and is_better(power, attempts, elapsed_seconds, stat)
    stat.total_daru_points += earned_points
    stat.play_count += 1
    stat.updated_at = now
    if improved:
        stat.score_version = CURRENT_SCORE_VERSION
        stat.best_detection_power = power
        stat.best_attempts = attempts
        stat.best_elapsed_seconds = elapsed_seconds
        stat.best_combo = max_combo
        stat.best_hints_used = hints_used
        stat.best_achieved_at = now
    return improved


def submit_result(db: Session, *, run: DaruGameRun, user_id: int, finish_partial: bool = False) -> tuple[DaruGameStat, DaruGamePlayRecord, bool, dict[str, int | bool | Decimal]]:
    now = utc_now()
    _require_started(run)
    config = DIFFICULTY_CONFIG[run.difficulty]
    started_at = run.play_started_at if run.play_started_at.tzinfo is not None else run.play_started_at.replace(tzinfo=UTC)
    elapsed_seconds = max(1, int((now - started_at).total_seconds()))
    completed = run.matched_pairs == config["pairs"]
    if not completed and not finish_partial:
        raise ValueError("Game run is not complete")
    if not completed and elapsed_seconds < config["time_limit_seconds"]:
        raise ValueError("Active game cannot be finalized as partial")
    within_time_limit = completed and elapsed_seconds <= config["time_limit_seconds"]
    earned_points = run.earned_daru_points + (config["clear_bonus"] if completed else 0)
    eligible = completed
    power = calculate_detection_power(run.difficulty, run.attempts, elapsed_seconds, run.max_combo, run.hints_used, within_time_limit)
    ranking_score = calculate_ranking_score(run.difficulty, run.attempts, elapsed_seconds, run.max_combo, run.hints_used, within_time_limit)
    run.consumed_at = now
    difficulty = run.difficulty
    attempts = run.attempts
    max_combo = run.max_combo
    hints_used = run.hints_used
    db.scalar(select(User).where(User.id == user_id).with_for_update())
    stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == difficulty).with_for_update())
    if stat is None:
        stat = DaruGameStat(user_id=user_id, difficulty=difficulty, best_detection_power=power if eligible else Decimal("0.0"), score_version=CURRENT_SCORE_VERSION, best_attempts=attempts if eligible else None, best_elapsed_seconds=elapsed_seconds if eligible else None, best_combo=max_combo if eligible else 0, best_hints_used=hints_used if eligible else None, total_daru_points=earned_points, play_count=1, best_achieved_at=now if eligible else None, created_at=now, updated_at=now)
        db.add(stat)
        improved = eligible
    else:
        improved = _apply_result(stat, eligible=eligible, power=power, attempts=attempts, elapsed_seconds=elapsed_seconds, max_combo=max_combo, hints_used=hints_used, earned_points=earned_points, now=now)
    db.flush()
    play_record = DaruGamePlayRecord(
        user_id=user_id, difficulty=difficulty, detection_power=power, ranking_score=ranking_score, attempts=attempts,
        elapsed_seconds=elapsed_seconds, max_combo=max_combo, hints_used=hints_used,
        earned_daru_points=earned_points, completed=completed,
        within_time_limit=within_time_limit, score_version=CURRENT_SCORE_VERSION,
        achieved_at=now, created_at=now,
    )
    db.add(play_record)
    db.flush()
    if completed:
        stat.ranking_record_id = play_record.id
        db.flush()
    metrics = detection_metrics(difficulty, attempts, elapsed_seconds, max_combo, hints_used, within_time_limit)
    return stat, play_record, improved, {
        **metrics,
        "attempts": attempts,
        "matched_pairs": run.matched_pairs,
        "max_combo": max_combo,
        "hints_used": hints_used,
        "elapsed_seconds": elapsed_seconds,
        "earned_daru_points": earned_points,
        "within_time_limit": within_time_limit,
        "completed": completed,
    }


def game_run_state(db: Session, *, run_id: UUID, user_id: int) -> dict[str, Any]:
    run = _locked_owned_run(db, run_id=run_id, user_id=user_id)
    if run.consumed_at is None:
        _ensure_not_expired(run)
    visible_positions = set(run.matched_positions or [])
    if run.first_position is not None:
        visible_positions.add(run.first_position)
    completion_receipt = db.scalar(
        select(DaruGameRunAction)
        .where(DaruGameRunAction.run_id == run.id, DaruGameRunAction.action_type == "COMPLETE")
        .order_by(DaruGameRunAction.created_at.desc())
    )
    status = "COMPLETED" if run.consumed_at is not None else "PLAYING" if run.play_started_at is not None else "CREATED"
    return {
        "run_id": str(run.id),
        "difficulty": run.difficulty,
        "status": status,
        "positions": list(range(len(run.deck_state))),
        "play_started_at": run.play_started_at.isoformat() if run.play_started_at else None,
        "server_now": utc_now().isoformat(),
        "attempts": run.attempts,
        "matched_pairs": run.matched_pairs,
        "current_combo": run.current_combo,
        "max_combo": run.max_combo,
        "hints_used": run.hints_used,
        "earned_daru_points": run.earned_daru_points,
        "matched_positions": list(run.matched_positions or []),
        "first_position": run.first_position,
        "visible_cards": [{"position": position, "card_id": run.deck_state[position]} for position in sorted(visible_positions)],
        "completion_result": dict(completion_receipt.response_payload) if completion_receipt else None,
    }


def ranking_query(difficulty: str):
    return (
        select(DaruGameStat, DaruGamePlayRecord, User.nickname)
        .join(User, User.id == DaruGameStat.user_id)
        .join(DaruGamePlayRecord, DaruGamePlayRecord.id == DaruGameStat.ranking_record_id)
        .where(
            DaruGameStat.difficulty == difficulty,
            DaruGamePlayRecord.score_version == CURRENT_SCORE_VERSION,
            DaruGamePlayRecord.completed.is_(True),
            DaruGamePlayRecord.deleted_at.is_(None),
            User.role == "USER", User.active.is_(True), User.deleted_at.is_(None),
        )
        .order_by(DaruGamePlayRecord.ranking_score.desc(), DaruGamePlayRecord.achieved_at.asc(), DaruGamePlayRecord.id.asc())
    )


def ranked_leaderboard_subquery(difficulty: str):
    rank_value = func.rank().over(order_by=DaruGamePlayRecord.ranking_score.desc()).label("rank")
    tie_count = func.count().over(partition_by=DaruGamePlayRecord.ranking_score).label("tie_count")
    return (
        select(
            DaruGameStat.id.label("stat_id"),
            DaruGameStat.user_id,
            User.nickname,
            DaruGamePlayRecord.id.label("record_id"),
            DaruGamePlayRecord.detection_power,
            DaruGamePlayRecord.ranking_score,
            DaruGamePlayRecord.attempts,
            DaruGamePlayRecord.elapsed_seconds,
            DaruGamePlayRecord.max_combo,
            DaruGamePlayRecord.hints_used,
            DaruGamePlayRecord.achieved_at,
            rank_value,
            tie_count,
        )
        .join(User, User.id == DaruGameStat.user_id)
        .join(DaruGamePlayRecord, DaruGamePlayRecord.id == DaruGameStat.ranking_record_id)
        .where(
            DaruGameStat.difficulty == difficulty,
            DaruGamePlayRecord.score_version == CURRENT_SCORE_VERSION,
            DaruGamePlayRecord.completed.is_(True),
            DaruGamePlayRecord.deleted_at.is_(None),
            User.role == "USER",
            User.active.is_(True),
            User.deleted_at.is_(None),
        )
        .subquery("ranked_daru_leaderboard")
    )


def leaderboard_rank(db: Session, stat: DaruGameStat) -> int | None:
    ranked = ranked_leaderboard_subquery(stat.difficulty)
    rank = db.scalar(select(ranked.c.rank).where(ranked.c.stat_id == stat.id))
    return int(rank) if rank is not None else None


def best_record_query(user_id: int, difficulty: str):
    return (
        select(DaruGamePlayRecord)
        .where(
            DaruGamePlayRecord.user_id == user_id,
            DaruGamePlayRecord.difficulty == difficulty,
            DaruGamePlayRecord.completed.is_(True),
            DaruGamePlayRecord.deleted_at.is_(None),
            DaruGamePlayRecord.score_version == CURRENT_SCORE_VERSION,
        )
        .order_by(DaruGamePlayRecord.detection_power.desc(), DaruGamePlayRecord.attempts.asc(), DaruGamePlayRecord.elapsed_seconds.asc(), DaruGamePlayRecord.achieved_at.asc())
    )


def recompute_best(db: Session, stat: DaruGameStat) -> None:
    best = db.scalar(best_record_query(stat.user_id, stat.difficulty).limit(1))
    if best is None:
        stat.best_detection_power = Decimal("0.0")
        stat.best_attempts = None
        stat.best_elapsed_seconds = None
        stat.best_combo = 0
        stat.best_hints_used = None
        stat.best_achieved_at = None
    else:
        stat.score_version = best.score_version
        stat.best_detection_power = best.detection_power
        stat.best_attempts = best.attempts
        stat.best_elapsed_seconds = best.elapsed_seconds
        stat.best_combo = best.max_combo
        stat.best_hints_used = best.hints_used
        stat.best_achieved_at = best.achieved_at
    stat.updated_at = utc_now()


def soft_delete_play_record(db: Session, *, user_id: int, record_id: int) -> DaruGamePlayRecord | None:
    records = soft_delete_play_records(db, user_id=user_id, record_ids=[record_id])
    return records[0] if records else None


def restore_play_record(db: Session, *, user_id: int, record_id: int) -> DaruGamePlayRecord | None:
    record = db.scalar(
        select(DaruGamePlayRecord)
        .where(
            DaruGamePlayRecord.id == record_id,
            DaruGamePlayRecord.user_id == user_id,
            DaruGamePlayRecord.deleted_at.is_not(None),
        )
        .with_for_update()
    )
    if record is None:
        return None
    stat = db.scalar(
        select(DaruGameStat)
        .where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == record.difficulty)
        .with_for_update()
    )
    record.deleted_at = None
    db.flush()
    if stat is not None:
        recompute_best(db, stat)
    db.commit()
    return record


def permanently_delete_play_record(db: Session, *, user_id: int, record_id: int) -> DaruGamePlayRecord | None:
    record = db.scalar(
        select(DaruGamePlayRecord)
        .where(
            DaruGamePlayRecord.id == record_id,
            DaruGamePlayRecord.user_id == user_id,
            DaruGamePlayRecord.deleted_at.is_not(None),
        )
        .with_for_update()
    )
    if record is None:
        return None
    stat = db.scalar(
        select(DaruGameStat)
        .where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == record.difficulty)
        .with_for_update()
    )
    if stat is not None and stat.ranking_record_id == record.id:
        db.rollback()
        raise ProtectedRankingRecordError(RANKING_RECORD_DELETE_PROTECTED_MESSAGE)
    db.delete(record)
    db.flush()
    if stat is not None:
        recompute_best(db, stat)
    db.commit()
    return record


def permanently_delete_trash(db: Session, *, user_id: int, difficulty: str) -> int:
    records = db.scalars(
        select(DaruGamePlayRecord)
        .where(
            DaruGamePlayRecord.user_id == user_id,
            DaruGamePlayRecord.difficulty == difficulty,
            DaruGamePlayRecord.deleted_at.is_not(None),
        )
        .with_for_update()
    ).all()
    if not records:
        return 0
    stat = db.scalar(
        select(DaruGameStat)
        .where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == difficulty)
        .with_for_update()
    )
    deletable_records = [record for record in records if stat is None or record.id != stat.ranking_record_id]
    for record in deletable_records:
        db.delete(record)
    db.flush()
    if stat is not None:
        recompute_best(db, stat)
    db.commit()
    return len(deletable_records)


def soft_delete_play_records(
    db: Session,
    *,
    user_id: int,
    record_ids: list[int] | None = None,
    difficulty: str | None = None,
    exclude_record_ids: list[int] | None = None,
) -> list[DaruGamePlayRecord] | None:
    selected_ids = set(record_ids or [])
    excluded_ids = set(exclude_record_ids or [])
    user_stats = db.scalars(select(DaruGameStat).where(DaruGameStat.user_id == user_id).with_for_update()).all()
    ranking_ids = {stat.ranking_record_id for stat in user_stats if stat.ranking_record_id is not None}
    query = select(DaruGamePlayRecord).where(
        DaruGamePlayRecord.user_id == user_id,
        DaruGamePlayRecord.deleted_at.is_(None),
    )
    if difficulty is not None:
        query = query.where(DaruGamePlayRecord.difficulty == difficulty)
        if ranking_ids:
            query = query.where(DaruGamePlayRecord.id.not_in(ranking_ids))
        if excluded_ids:
            query = query.where(DaruGamePlayRecord.id.not_in(excluded_ids))
    else:
        if selected_ids & ranking_ids:
            db.rollback()
            raise ProtectedRankingRecordError(RANKING_RECORD_DELETE_PROTECTED_MESSAGE)
        query = query.where(DaruGamePlayRecord.id.in_(selected_ids))
    records = db.scalars(query.with_for_update()).all()
    if difficulty is None and {record.id for record in records} != selected_ids:
        db.rollback()
        return None

    now = utc_now()
    affected_difficulties = {record.difficulty for record in records}
    for record in records:
        record.deleted_at = now
    db.flush()
    if affected_difficulties:
        for stat in user_stats:
            if stat.difficulty not in affected_difficulties:
                continue
            recompute_best(db, stat)
    db.commit()
    return records


def soft_delete_all_play_records(db: Session, *, user_id: int) -> int:
    stats = db.scalars(select(DaruGameStat).where(DaruGameStat.user_id == user_id).with_for_update()).all()
    ranking_ids = {stat.ranking_record_id for stat in stats if stat.ranking_record_id is not None}
    query = select(DaruGamePlayRecord).where(DaruGamePlayRecord.user_id == user_id, DaruGamePlayRecord.deleted_at.is_(None))
    if ranking_ids:
        query = query.where(DaruGamePlayRecord.id.not_in(ranking_ids))
    records = db.scalars(query.with_for_update()).all()
    now = utc_now()
    for record in records:
        record.deleted_at = now
    db.flush()
    for stat in stats:
        recompute_best(db, stat)
    db.commit()
    return len(records)
