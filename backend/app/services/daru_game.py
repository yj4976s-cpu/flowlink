from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import DaruGameRun, DaruGameStat, User


DIFFICULTY_CONFIG = {
    "EASY": {"pairs": 10, "time_limit_seconds": 120, "speed_benchmark_seconds": 90, "combo_target": 5, "clear_bonus": 300, "preview_seconds": 5},
    "NORMAL": {"pairs": 16, "time_limit_seconds": 210, "speed_benchmark_seconds": 150, "combo_target": 7, "clear_bonus": 500, "preview_seconds": 7},
    "HARD": {"pairs": 24, "time_limit_seconds": 330, "speed_benchmark_seconds": 240, "combo_target": 9, "clear_bonus": 700, "preview_seconds": 9},
}
GAME_RUN_MAX_AGE = timedelta(hours=24)
GAME_RUN_ELAPSED_TOLERANCE_SECONDS = 10
GAME_RUN_TRANSITION_ALLOWANCE_SECONDS = 2
GAME_RUN_NETWORK_ALLOWANCE_SECONDS = 30
CURRENT_SCORE_VERSION = 2
SCORE_TENTH = Decimal("0.1")


class GameRunNotFoundError(ValueError):
    pass


class GameRunConflictError(ValueError):
    pass


def create_game_run(db: Session, *, user_id: int, difficulty: str) -> DaruGameRun:
    now = utc_now()
    run = DaruGameRun(id=uuid4(), user_id=user_id, difficulty=difficulty, started_at=now)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def game_run_lock_query(run_id: UUID):
    return select(DaruGameRun).where(DaruGameRun.id == run_id).with_for_update()


def _lock_and_consume_game_run(db: Session, *, run_id: UUID, user_id: int, difficulty: str, elapsed_seconds: int, now: datetime) -> DaruGameRun:
    run = db.scalar(game_run_lock_query(run_id))
    if run is None or run.user_id != user_id:
        raise GameRunNotFoundError("Game run not found")
    if run.difficulty != difficulty:
        raise ValueError("Game run difficulty does not match result")
    if run.consumed_at is not None:
        raise GameRunConflictError("Game run has already been consumed")
    started_at = run.started_at if run.started_at.tzinfo is not None else run.started_at.replace(tzinfo=UTC)
    run_age = now - started_at
    if run_age < timedelta(0) or run_age > GAME_RUN_MAX_AGE:
        raise GameRunConflictError("Game run has expired")
    if elapsed_seconds > run_age.total_seconds() + GAME_RUN_ELAPSED_TOLERANCE_SECONDS:
        raise ValueError("Result elapsed time exceeds the server game run duration")
    maximum_non_play_seconds = DIFFICULTY_CONFIG[difficulty]["preview_seconds"] + GAME_RUN_TRANSITION_ALLOWANCE_SECONDS + GAME_RUN_NETWORK_ALLOWANCE_SECONDS
    if run_age.total_seconds() - elapsed_seconds > maximum_non_play_seconds:
        raise ValueError("Result elapsed time is implausibly short for the server game run duration")
    run.consumed_at = now
    return run


def _round_to_tenth(value: Decimal) -> Decimal:
    return value.quantize(SCORE_TENTH, rounding=ROUND_HALF_UP)


def calculate_memory_accuracy(pair_count: int, attempts: int) -> Decimal:
    if attempts <= 0:
        return Decimal("0")
    extra_attempt_ratio = Decimal(attempts - pair_count) / Decimal(pair_count)
    return max(Decimal("0"), min(Decimal("100"), Decimal("100") - extra_attempt_ratio * Decimal("50")))


def calculate_hint_score(hints_used: int) -> Decimal:
    return max(Decimal("0"), min(Decimal("100"), Decimal("100") - Decimal(hints_used * 50)))


def calculate_speed_score(elapsed_seconds: int, benchmark_seconds: int, time_limit_seconds: int, within_time_limit: bool = True) -> float:
    if not within_time_limit or elapsed_seconds > time_limit_seconds:
        return 0
    elapsed = max(1, elapsed_seconds)
    half_benchmark = benchmark_seconds * 0.5
    if elapsed <= half_benchmark:
        return 100
    if elapsed <= benchmark_seconds:
        progress = (elapsed - half_benchmark) / half_benchmark
        return max(0, min(100, 100 - 20 * progress))
    overtime_ratio = (elapsed - benchmark_seconds) / (time_limit_seconds - benchmark_seconds)
    return max(40, min(100, 80 - 40 * overtime_ratio))


def calculate_detection_power(difficulty: str, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, within_time_limit: bool = True) -> Decimal:
    config = DIFFICULTY_CONFIG[difficulty]
    memory = calculate_memory_accuracy(config["pairs"], attempts)
    speed = Decimal(str(calculate_speed_score(elapsed_seconds, config["speed_benchmark_seconds"], config["time_limit_seconds"], within_time_limit)))
    combo = min(Decimal("1"), Decimal(max_combo) / Decimal(config["combo_target"])) * Decimal("100")
    hint = calculate_hint_score(hints_used)
    power = memory * Decimal("0.50") + speed * Decimal("0.25") + combo * Decimal("0.15") + hint * Decimal("0.10")
    return max(Decimal("0.0"), min(Decimal("100.0"), _round_to_tenth(power)))


def rank_for(power: Decimal | float | int) -> str:
    if power >= 80: return "S"
    if power >= 65: return "A"
    if power >= 50: return "B"
    return "C"


def maximum_pair_points(matched_pairs: int) -> int:
    return sum(100 + min(max(0, combo - 1) * 25, 100) for combo in range(1, matched_pairs + 1))


def validate_result(difficulty: str, *, completed: bool, within_time_limit: bool, matched_pairs: int, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, earned_points: int) -> None:
    config = DIFFICULTY_CONFIG[difficulty]
    pairs = config["pairs"]
    if not 0 <= hints_used <= 2 or not 0 <= matched_pairs <= pairs or attempts < matched_pairs or max_combo > matched_pairs:
        raise ValueError("Invalid game result")
    if completed and matched_pairs != pairs:
        raise ValueError("Completed game must contain every pair")
    if not completed and within_time_limit:
        raise ValueError("Partial game cannot be an official result")
    if within_time_limit and elapsed_seconds > config["time_limit_seconds"]:
        raise ValueError("Result exceeds the difficulty time limit")
    if not within_time_limit and elapsed_seconds < config["time_limit_seconds"]:
        raise ValueError("Overtime result is below the difficulty time limit")
    minimum_points = matched_pairs * 100 + (config["clear_bonus"] if completed else 0)
    maximum_points = maximum_pair_points(matched_pairs) + (config["clear_bonus"] if completed else 0)
    if not minimum_points <= earned_points <= maximum_points:
        raise ValueError("Invalid earned Daru points")


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


def submit_result(db: Session, *, run_id: UUID, user_id: int, difficulty: str, completed: bool, within_time_limit: bool, matched_pairs: int, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, earned_points: int) -> tuple[DaruGameStat, bool]:
    validate_result(difficulty, completed=completed, within_time_limit=within_time_limit, matched_pairs=matched_pairs, attempts=attempts, elapsed_seconds=elapsed_seconds, max_combo=max_combo, hints_used=hints_used, earned_points=earned_points)
    eligible = completed and within_time_limit
    power = calculate_detection_power(difficulty, attempts, elapsed_seconds, max_combo, hints_used, within_time_limit)
    now = utc_now()
    _lock_and_consume_game_run(db, run_id=run_id, user_id=user_id, difficulty=difficulty, elapsed_seconds=elapsed_seconds, now=now)
    stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == difficulty).with_for_update())
    inserting = stat is None
    if inserting:
        stat = DaruGameStat(user_id=user_id, difficulty=difficulty, best_detection_power=power if eligible else Decimal("0.0"), score_version=CURRENT_SCORE_VERSION, best_attempts=attempts if eligible else None, best_elapsed_seconds=elapsed_seconds if eligible else None, best_combo=max_combo if eligible else 0, best_hints_used=hints_used if eligible else None, total_daru_points=earned_points, play_count=1, best_achieved_at=now if eligible else None, created_at=now, updated_at=now)
        db.add(stat)
        improved = eligible
    else:
        improved = _apply_result(stat, eligible=eligible, power=power, attempts=attempts, elapsed_seconds=elapsed_seconds, max_combo=max_combo, hints_used=hints_used, earned_points=earned_points, now=now)
    try:
        db.commit()
    except IntegrityError:
        if not inserting:
            raise
        db.rollback()
        now = utc_now()
        _lock_and_consume_game_run(db, run_id=run_id, user_id=user_id, difficulty=difficulty, elapsed_seconds=elapsed_seconds, now=now)
        stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == difficulty).with_for_update())
        if stat is None:
            raise
        improved = _apply_result(stat, eligible=eligible, power=power, attempts=attempts, elapsed_seconds=elapsed_seconds, max_combo=max_combo, hints_used=hints_used, earned_points=earned_points, now=now)
        db.commit()
    db.refresh(stat)
    return stat, improved


def ranking_query(difficulty: str):
    return select(DaruGameStat, User.nickname).join(User, User.id == DaruGameStat.user_id).where(DaruGameStat.difficulty == difficulty, DaruGameStat.score_version == CURRENT_SCORE_VERSION, DaruGameStat.best_attempts.is_not(None), User.role == "USER", User.active.is_(True), User.deleted_at.is_(None)).order_by(DaruGameStat.best_detection_power.desc(), DaruGameStat.best_attempts.asc(), DaruGameStat.best_elapsed_seconds.asc(), DaruGameStat.best_achieved_at.asc())


def leaderboard_rank(db: Session, stat: DaruGameStat) -> int | None:
    ranked_ids = [item.id for item, _nickname in db.execute(ranking_query(stat.difficulty)).all()]
    try: return ranked_ids.index(stat.id) + 1
    except ValueError: return None
