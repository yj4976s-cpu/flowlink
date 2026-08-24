from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_optional_current_user, require_user
from app.db.session import get_db
from app.models import DaruGameStat, User
from app.schemas.daru_game import DaruGameRecord, DaruGameResultInput, DaruGameResultResponse, DaruGameRunInput, DaruGameRunResponse, DaruLeaderboardEntry, DaruLeaderboardResponse, Difficulty
from app.services.daru_game import GameRunConflictError, GameRunNotFoundError, create_game_run, leaderboard_rank, rank_for, ranking_query, submit_result

router = APIRouter(prefix="/api/daru-game", tags=["daru-game"])


def record_response(stat: DaruGameStat) -> DaruGameRecord:
    return DaruGameRecord(difficulty=stat.difficulty, best_detection_power=float(stat.best_detection_power), score_version=stat.score_version, best_attempts=stat.best_attempts, best_elapsed_seconds=stat.best_elapsed_seconds, best_combo=stat.best_combo, best_hints_used=stat.best_hints_used, total_daru_points=stat.total_daru_points, play_count=stat.play_count, best_achieved_at=stat.best_achieved_at, rank=rank_for(stat.best_detection_power))


@router.post("/runs", response_model=DaruGameRunResponse, status_code=201)
def create_run(payload: DaruGameRunInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameRunResponse:
    run = create_game_run(db, user_id=current_user.id, difficulty=payload.difficulty)
    return DaruGameRunResponse(run_id=run.id, difficulty=run.difficulty, started_at=run.started_at)


@router.post("/results", response_model=DaruGameResultResponse)
def create_result(payload: DaruGameResultInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameResultResponse:
    try:
        stat, improved = submit_result(db, run_id=payload.run_id, user_id=current_user.id, difficulty=payload.difficulty, completed=payload.completed, within_time_limit=payload.within_time_limit, matched_pairs=payload.matched_pairs, attempts=payload.attempts, elapsed_seconds=payload.elapsed_seconds, max_combo=payload.max_combo, hints_used=payload.hints_used, earned_points=payload.earned_daru_points)
    except GameRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GameRunConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DaruGameResultResponse(record=record_response(stat), is_new_best=improved, leaderboard_rank=leaderboard_rank(db, stat))


@router.get("/leaderboard", response_model=DaruLeaderboardResponse)
def leaderboard(db: Annotated[Session, Depends(get_db)], current_user: Annotated[User | None, Depends(get_optional_current_user)], difficulty: Annotated[Difficulty, Query()] = "EASY") -> DaruLeaderboardResponse:
    rows = db.execute(ranking_query(difficulty)).all()
    entries = [DaruLeaderboardEntry(rank=index, nickname=nickname, best_detection_power=float(stat.best_detection_power), best_attempts=stat.best_attempts or 0, best_elapsed_seconds=stat.best_elapsed_seconds or 0, best_combo=stat.best_combo, best_hints_used=stat.best_hints_used or 0, achieved_at=stat.best_achieved_at or stat.created_at, is_me=current_user is not None and current_user.role == "USER" and stat.user_id == current_user.id) for index, (stat, nickname) in enumerate(rows, 1)]
    top = entries[:10]
    mine = next((entry for entry in entries if entry.is_me), None)
    return DaruLeaderboardResponse(difficulty=difficulty, entries=top, my_entry=mine)


@router.get("/me", response_model=list[DaruGameRecord])
def my_records(current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> list[DaruGameRecord]:
    stats = db.scalars(select(DaruGameStat).where(DaruGameStat.user_id == current_user.id).order_by(DaruGameStat.difficulty)).all()
    return [record_response(stat) for stat in stats]
