from typing import Annotated
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_optional_current_user, require_user
from app.db.session import get_db
from app.models import DaruGameStat, User
from app.schemas.daru_game import DaruGameCardReveal, DaruGameFlipInput, DaruGameFlipResponse, DaruGameHintResponse, DaruGameMetrics, DaruGameRecord, DaruGameResultInput, DaruGameResultResponse, DaruGameRunInput, DaruGameRunResponse, DaruLeaderboardEntry, DaruLeaderboardResponse, Difficulty
from app.services.daru_game import GameRunConflictError, GameRunNotFoundError, create_game_run, flip_card, leaderboard_rank, rank_for, ranking_query, start_gameplay, submit_result, use_game_hint

router = APIRouter(prefix="/api/daru-game", tags=["daru-game"])


def record_response(stat: DaruGameStat) -> DaruGameRecord:
    return DaruGameRecord(difficulty=stat.difficulty, best_detection_power=float(stat.best_detection_power), score_version=stat.score_version, best_attempts=stat.best_attempts, best_elapsed_seconds=stat.best_elapsed_seconds, best_combo=stat.best_combo, best_hints_used=stat.best_hints_used, total_daru_points=stat.total_daru_points, play_count=stat.play_count, best_achieved_at=stat.best_achieved_at, rank=rank_for(stat.best_detection_power))


@router.post("/runs", response_model=DaruGameRunResponse, status_code=201)
def create_run(payload: DaruGameRunInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameRunResponse:
    run = create_game_run(db, user_id=current_user.id, difficulty=payload.difficulty)
    return DaruGameRunResponse(run_id=run.id, difficulty=run.difficulty, started_at=run.started_at, positions=list(range(len(run.deck_state))))


def _run_error(exc: ValueError) -> HTTPException:
    if isinstance(exc, GameRunNotFoundError): return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, GameRunConflictError): return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


@router.post("/runs/{run_id}/start", status_code=204)
def start_run(run_id: UUID, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> None:
    try: start_gameplay(db, run_id=run_id, user_id=current_user.id)
    except ValueError as exc: raise _run_error(exc) from exc


@router.post("/runs/{run_id}/flip", response_model=DaruGameFlipResponse)
def flip_run_card(run_id: UUID, payload: DaruGameFlipInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameFlipResponse:
    try: run, matched, points_awarded = flip_card(db, run_id=run_id, user_id=current_user.id, position=payload.position)
    except ValueError as exc: raise _run_error(exc) from exc
    return DaruGameFlipResponse(card=DaruGameCardReveal(position=payload.position, card_id=run.deck_state[payload.position]), matched=matched, matched_positions=list(run.matched_positions), attempts=run.attempts, matched_pairs=run.matched_pairs, current_combo=run.current_combo, max_combo=run.max_combo, earned_daru_points=run.earned_daru_points, points_awarded=points_awarded)


@router.post("/runs/{run_id}/hint", response_model=DaruGameHintResponse)
def hint_run(run_id: UUID, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameHintResponse:
    try: run = use_game_hint(db, run_id=run_id, user_id=current_user.id)
    except ValueError as exc: raise _run_error(exc) from exc
    return DaruGameHintResponse(hints_used=run.hints_used, hints_remaining=2 - run.hints_used, cards=[DaruGameCardReveal(position=index, card_id=card_id) for index, card_id in enumerate(run.deck_state)])


@router.post("/results", response_model=DaruGameResultResponse)
def create_result(payload: DaruGameResultInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameResultResponse:
    try:
        stat, improved, metrics = submit_result(db, run_id=payload.run_id, user_id=current_user.id, finish_partial=payload.finish_partial)
    except ValueError as exc:
        raise _run_error(exc) from exc
    return DaruGameResultResponse(record=record_response(stat), is_new_best=improved, leaderboard_rank=leaderboard_rank(db, stat), metrics=DaruGameMetrics(**{key: float(value) if isinstance(value, Decimal) else value for key, value in metrics.items()}))


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
