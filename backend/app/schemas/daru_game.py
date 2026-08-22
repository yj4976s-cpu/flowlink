from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


Difficulty = Literal["EASY", "NORMAL", "HARD"]


class DaruGameResultInput(BaseModel):
    difficulty: Difficulty
    completed: bool
    within_time_limit: bool
    matched_pairs: int = Field(ge=0)
    attempts: int = Field(ge=0)
    elapsed_seconds: int = Field(gt=0)
    max_combo: int = Field(ge=0)
    hints_used: int = Field(ge=0, le=2)
    earned_daru_points: int = Field(ge=0)


class DaruGameRecord(BaseModel):
    difficulty: Difficulty
    best_detection_power: int
    best_attempts: int | None
    best_elapsed_seconds: int | None
    best_combo: int
    best_hints_used: int | None
    total_daru_points: int
    play_count: int
    best_achieved_at: datetime | None
    rank: Literal["S", "A", "B", "C"]


class DaruGameResultResponse(BaseModel):
    record: DaruGameRecord
    is_new_best: bool
    leaderboard_rank: int | None


class DaruLeaderboardEntry(BaseModel):
    rank: int
    nickname: str
    best_detection_power: int
    best_attempts: int
    best_elapsed_seconds: int
    best_combo: int
    best_hints_used: int
    achieved_at: datetime
    is_me: bool = False


class DaruLeaderboardResponse(BaseModel):
    difficulty: Difficulty
    entries: list[DaruLeaderboardEntry]
    my_entry: DaruLeaderboardEntry | None
