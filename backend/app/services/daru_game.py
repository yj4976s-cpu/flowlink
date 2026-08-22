from __future__ import annotations

import math
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import DaruGameStat, User


DIFFICULTY_CONFIG = {
    "EASY": {"pairs": 10, "time_limit_seconds": 120, "speed_benchmark_seconds": 90, "combo_target": 5, "clear_bonus": 300},
    "NORMAL": {"pairs": 16, "time_limit_seconds": 210, "speed_benchmark_seconds": 150, "combo_target": 7, "clear_bonus": 500},
    "HARD": {"pairs": 24, "time_limit_seconds": 330, "speed_benchmark_seconds": 240, "combo_target": 9, "clear_bonus": 700},
}


def _round_like_javascript(value: float) -> int:
    return math.floor(value + 0.5)


def calculate_speed_score(elapsed_seconds: int, benchmark_seconds: int, time_limit_seconds: int, within_time_limit: bool = True) -> float:
    if not within_time_limit:
        return 0
    elapsed = max(1, elapsed_seconds)
    if elapsed <= benchmark_seconds:
        return max(0, min(100, 80 + 20 * (1 - elapsed / benchmark_seconds)))
    overtime_ratio = (elapsed - benchmark_seconds) / (time_limit_seconds - benchmark_seconds)
    return max(40, min(100, 80 - 40 * overtime_ratio))


def calculate_detection_power(difficulty: str, attempts: int, elapsed_seconds: int, max_combo: int, within_time_limit: bool = True) -> int:
    config = DIFFICULTY_CONFIG[difficulty]
    memory = min(1, config["pairs"] / attempts) * 100 if attempts > 0 else 0
    speed = calculate_speed_score(elapsed_seconds, config["speed_benchmark_seconds"], config["time_limit_seconds"], within_time_limit)
    combo = min(1, max_combo / config["combo_target"]) * 100
    return max(0, min(100, _round_like_javascript(memory * 0.60 + speed * 0.25 + combo * 0.15)))


def rank_for(power: int) -> str:
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


def is_better(power: int, hints_used: int, attempts: int, elapsed: int, current: DaruGameStat) -> bool:
    current_key = (-(current.best_detection_power), current.best_hints_used if current.best_hints_used is not None else 2**31, current.best_attempts or 2**31, current.best_elapsed_seconds or 2**31)
    candidate_key = (-power, hints_used, attempts, elapsed)
    return candidate_key < current_key


def _apply_result(stat: DaruGameStat, *, eligible: bool, power: int, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, earned_points: int, now: datetime) -> bool:
    improved = eligible and is_better(power, hints_used, attempts, elapsed_seconds, stat)
    stat.total_daru_points += earned_points
    stat.play_count += 1
    stat.updated_at = now
    if improved:
        stat.best_detection_power = power
        stat.best_attempts = attempts
        stat.best_elapsed_seconds = elapsed_seconds
        stat.best_combo = max_combo
        stat.best_hints_used = hints_used
        stat.best_achieved_at = now
    return improved


def submit_result(db: Session, *, user_id: int, difficulty: str, completed: bool, within_time_limit: bool, matched_pairs: int, attempts: int, elapsed_seconds: int, max_combo: int, hints_used: int, earned_points: int) -> tuple[DaruGameStat, bool]:
    validate_result(difficulty, completed=completed, within_time_limit=within_time_limit, matched_pairs=matched_pairs, attempts=attempts, elapsed_seconds=elapsed_seconds, max_combo=max_combo, hints_used=hints_used, earned_points=earned_points)
    eligible = completed and within_time_limit
    power = calculate_detection_power(difficulty, attempts, elapsed_seconds, max_combo, within_time_limit)
    now = utc_now()
    stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == difficulty).with_for_update())
    inserting = stat is None
    if inserting:
        stat = DaruGameStat(user_id=user_id, difficulty=difficulty, best_detection_power=power if eligible else 0, best_attempts=attempts if eligible else None, best_elapsed_seconds=elapsed_seconds if eligible else None, best_combo=max_combo if eligible else 0, best_hints_used=hints_used if eligible else None, total_daru_points=earned_points, play_count=1, best_achieved_at=now if eligible else None, created_at=now, updated_at=now)
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
        stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == user_id, DaruGameStat.difficulty == difficulty).with_for_update())
        if stat is None:
            raise
        improved = _apply_result(stat, eligible=eligible, power=power, attempts=attempts, elapsed_seconds=elapsed_seconds, max_combo=max_combo, hints_used=hints_used, earned_points=earned_points, now=now)
        db.commit()
    db.refresh(stat)
    return stat, improved


def ranking_query(difficulty: str):
    return select(DaruGameStat, User.nickname).join(User, User.id == DaruGameStat.user_id).where(DaruGameStat.difficulty == difficulty, DaruGameStat.best_attempts.is_not(None), User.role == "USER", User.active.is_(True), User.deleted_at.is_(None)).order_by(DaruGameStat.best_detection_power.desc(), DaruGameStat.best_hints_used.asc(), DaruGameStat.best_attempts.asc(), DaruGameStat.best_elapsed_seconds.asc(), DaruGameStat.best_achieved_at.asc())


def leaderboard_rank(db: Session, stat: DaruGameStat) -> int | None:
    ranked_ids = [item.id for item, _nickname in db.execute(ranking_query(stat.difficulty)).all()]
    try: return ranked_ids.index(stat.id) + 1
    except ValueError: return None
