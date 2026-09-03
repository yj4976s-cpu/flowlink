from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


Difficulty = Literal["EASY", "NORMAL", "HARD"]


class DaruGameRunInput(BaseModel):
    difficulty: Difficulty


class DaruGameRunResponse(BaseModel):
    run_id: UUID
    difficulty: Difficulty
    started_at: datetime
    positions: list[int]


class DaruGameResultInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: UUID
    action_id: UUID
    finish_partial: bool = False


class DaruGameFlipInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: UUID
    position: int = Field(ge=0)


class DaruGameActionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: UUID


class DaruGameStartResponse(BaseModel):
    play_started_at: datetime


class DaruGameCardReveal(BaseModel):
    position: int
    card_id: str


class DaruGamePreviewResponse(BaseModel):
    cards: list[DaruGameCardReveal]


class DaruGameFlipResponse(BaseModel):
    card: DaruGameCardReveal
    matched: bool | None
    matched_positions: list[int]
    attempts: int
    matched_pairs: int
    current_combo: int
    max_combo: int
    earned_daru_points: int
    points_awarded: int


class DaruGameHintResponse(BaseModel):
    hints_used: int
    hints_remaining: int
    cards: list[DaruGameCardReveal]


class DaruGameRunStateResponse(BaseModel):
    run_id: UUID
    difficulty: Difficulty
    status: Literal["CREATED", "PLAYING", "COMPLETED"]
    positions: list[int]
    play_started_at: datetime | None
    server_now: datetime
    attempts: int
    matched_pairs: int
    current_combo: int
    max_combo: int
    hints_used: int
    earned_daru_points: int
    matched_positions: list[int]
    first_position: int | None
    visible_cards: list[DaruGameCardReveal]
    completion_result: dict[str, object] | None = None


class DaruGameMetrics(BaseModel):
    memory_accuracy: float
    speed_score: float
    combo_score: float
    hint_score: float
    detection_power: float
    attempts: int
    matched_pairs: int
    max_combo: int
    hints_used: int
    elapsed_seconds: int
    earned_daru_points: int
    within_time_limit: bool
    completed: bool


class DaruGameRecord(BaseModel):
    difficulty: Difficulty
    best_detection_power: float
    score_version: int
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
    metrics: DaruGameMetrics


class DaruLeaderboardEntry(BaseModel):
    rank: int
    nickname: str
    detection_power: float
    attempts: int
    elapsed_seconds: int
    max_combo: int
    hints_used: int
    achieved_at: datetime
    is_me: bool = False
    is_tied: bool = False


class DaruLeaderboardResponse(BaseModel):
    difficulty: Difficulty
    top_entries: list[DaruLeaderboardEntry]
    entries: list[DaruLeaderboardEntry]
    my_entry: DaruLeaderboardEntry | None
    my_best: DaruGameRecord | None
    next_rank_score: float | None
    next_rank: int | None
    next_rank_gap: float | None
    my_page: int | None
    total: int
    page: int
    page_size: int
    total_pages: int


class DaruGameHistoryItem(BaseModel):
    id: int
    difficulty: Difficulty
    detection_power: float
    attempts: int
    elapsed_seconds: int
    max_combo: int
    hints_used: int
    earned_daru_points: int
    completed: bool
    within_time_limit: bool
    achieved_at: datetime
    deleted_at: datetime | None = None
    is_best: bool
    is_ranking_record: bool


class DaruGameHistoryResponse(BaseModel):
    difficulty: Difficulty
    items: list[DaruGameHistoryItem]
    total: int
    page: int
    page_size: int
    total_pages: int
    protected_count: int = 0
    deletable_count: int = 0
    deletable_best_record_id: int | None = None
    has_deletable_best: bool = False
    has_deletable_best_any_difficulty: bool = False


class DaruGameHistoryBatchDeleteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_ids: list[int] = Field(default_factory=list, max_length=500)
    difficulty: Difficulty | None = None
    exclude_record_ids: list[int] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def validate_scope(self):
        if self.difficulty is None and not self.record_ids:
            raise ValueError("Select at least one play record")
        if self.difficulty is not None and self.record_ids:
            raise ValueError("Choose record_ids or a difficulty scope, not both")
        if self.difficulty is None and self.exclude_record_ids:
            raise ValueError("exclude_record_ids requires a difficulty scope")
        return self


class DaruGameHistoryBatchDeleteResponse(BaseModel):
    deleted_count: int
