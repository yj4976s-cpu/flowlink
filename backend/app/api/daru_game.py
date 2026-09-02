from typing import Annotated
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import get_optional_current_user, require_user
from app.core.security import create_access_token
from app.api.auth import set_login_cookie
from app.db.session import get_db
from app.models import DaruGamePlayRecord, DaruGameStat, User
from app.schemas.daru_game import DaruGameActionInput, DaruGameFlipInput, DaruGameFlipResponse, DaruGameHintResponse, DaruGameHistoryBatchDeleteInput, DaruGameHistoryBatchDeleteResponse, DaruGameHistoryItem, DaruGameHistoryResponse, DaruGameMetrics, DaruGamePreviewResponse, DaruGameRecord, DaruGameResultInput, DaruGameResultResponse, DaruGameRunInput, DaruGameRunResponse, DaruGameRunStateResponse, DaruGameStartResponse, DaruLeaderboardEntry, DaruLeaderboardResponse, Difficulty
from app.services.daru_game import GameRunConflictError, GameRunExpiredError, GameRunNotFoundError, OutdatedGameRunError, best_record_query, create_game_run, flip_card, game_run_preview, game_run_state, leaderboard_rank, perform_game_action, permanently_delete_play_record, permanently_delete_trash, rank_for, ranking_query, restore_play_record, soft_delete_all_play_records, soft_delete_play_record, soft_delete_play_records, start_gameplay, submit_result, use_game_hint

router = APIRouter(prefix="/api/daru-game", tags=["daru-game"])


def record_response(stat: DaruGameStat) -> DaruGameRecord:
    return DaruGameRecord(difficulty=stat.difficulty, best_detection_power=float(stat.best_detection_power), score_version=stat.score_version, best_attempts=stat.best_attempts, best_elapsed_seconds=stat.best_elapsed_seconds, best_combo=stat.best_combo, best_hints_used=stat.best_hints_used, total_daru_points=stat.total_daru_points, play_count=stat.play_count, best_achieved_at=stat.best_achieved_at, rank=rank_for(stat.best_detection_power))


@router.post("/runs", response_model=DaruGameRunResponse, status_code=201)
def create_run(payload: DaruGameRunInput, request: Request, response: Response, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameRunResponse:
    run = create_game_run(db, user_id=current_user.id, difficulty=payload.difficulty)
    access_token, expires_in = create_access_token(current_user.id, current_user.role)
    set_login_cookie(response, request, access_token, expires_in)
    return DaruGameRunResponse(run_id=run.id, difficulty=run.difficulty, started_at=run.started_at, positions=list(range(len(run.deck_state))))


def _run_error(exc: ValueError) -> HTTPException:
    if isinstance(exc, GameRunNotFoundError): return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, OutdatedGameRunError): return HTTPException(status_code=409, detail={"code": "OUTDATED_DECK_CONFIGURATION", "message": str(exc)})
    if isinstance(exc, GameRunExpiredError): return HTTPException(status_code=409, detail={"code": "RUN_EXPIRED", "message": str(exc)})
    if isinstance(exc, GameRunConflictError): return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


@router.post("/runs/{run_id}/start", response_model=DaruGameStartResponse)
def start_run(run_id: UUID, payload: DaruGameActionInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameStartResponse:
    try: result = perform_game_action(db, run_id=run_id, user_id=current_user.id, action_id=payload.action_id, action_type="START", request_payload={}, handler=start_gameplay)
    except ValueError as exc: raise _run_error(exc) from exc
    return DaruGameStartResponse.model_validate(result)


@router.post("/runs/{run_id}/flip", response_model=DaruGameFlipResponse)
def flip_run_card(run_id: UUID, payload: DaruGameFlipInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameFlipResponse:
    try: result = perform_game_action(db, run_id=run_id, user_id=current_user.id, action_id=payload.action_id, action_type="FLIP", request_payload={"position": payload.position}, handler=lambda run: flip_card(run, position=payload.position))
    except ValueError as exc: raise _run_error(exc) from exc
    return DaruGameFlipResponse.model_validate(result)


@router.post("/runs/{run_id}/hint", response_model=DaruGameHintResponse)
def hint_run(run_id: UUID, payload: DaruGameActionInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameHintResponse:
    try: result = perform_game_action(db, run_id=run_id, user_id=current_user.id, action_id=payload.action_id, action_type="HINT", request_payload={}, handler=use_game_hint)
    except ValueError as exc: raise _run_error(exc) from exc
    return DaruGameHintResponse.model_validate(result)


@router.get("/runs/{run_id}/preview", response_model=DaruGamePreviewResponse)
def run_preview(run_id: UUID, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGamePreviewResponse:
    try: result = game_run_preview(db, run_id=run_id, user_id=current_user.id)
    except ValueError as exc: raise _run_error(exc) from exc
    return DaruGamePreviewResponse.model_validate(result)


@router.post("/results", response_model=DaruGameResultResponse)
def create_result(payload: DaruGameResultInput, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameResultResponse:
    def complete(run):
        stat, _play_record, improved, metrics = submit_result(db, run=run, user_id=current_user.id, finish_partial=payload.finish_partial)
        response = DaruGameResultResponse(record=record_response(stat), is_new_best=improved, leaderboard_rank=leaderboard_rank(db, stat), metrics=DaruGameMetrics(**{key: float(value) if isinstance(value, Decimal) else value for key, value in metrics.items()}))
        return response.model_dump(mode="json")
    try:
        result = perform_game_action(db, run_id=payload.run_id, user_id=current_user.id, action_id=payload.action_id, action_type="COMPLETE", request_payload={"finish_partial": payload.finish_partial}, handler=complete)
    except ValueError as exc:
        raise _run_error(exc) from exc
    return DaruGameResultResponse.model_validate(result)


@router.get("/runs/{run_id}/state", response_model=DaruGameRunStateResponse)
def run_state(run_id: UUID, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameRunStateResponse:
    try: result = game_run_state(db, run_id=run_id, user_id=current_user.id)
    except ValueError as exc: raise _run_error(exc) from exc
    return DaruGameRunStateResponse.model_validate(result)


@router.get("/leaderboard", response_model=DaruLeaderboardResponse)
def leaderboard(db: Annotated[Session, Depends(get_db)], current_user: Annotated[User | None, Depends(get_optional_current_user)], difficulty: Annotated[Difficulty, Query()] = "EASY", page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=20)] = 5) -> DaruLeaderboardResponse:
    rows = db.execute(ranking_query(difficulty)).all()
    entries = [DaruLeaderboardEntry(rank=index, nickname=nickname, detection_power=float(record.detection_power), attempts=record.attempts, elapsed_seconds=record.elapsed_seconds, max_combo=record.max_combo, hints_used=record.hints_used, achieved_at=record.achieved_at, is_me=current_user is not None and current_user.role == "USER" and stat.user_id == current_user.id) for index, (stat, record, nickname) in enumerate(rows, 1)]
    mine = next((entry for entry in entries if entry.is_me), None)
    general_entries = entries[3:]
    total_pages = max(1, (len(general_entries) + page_size - 1) // page_size)
    current_page = min(page, total_pages)
    offset = (current_page - 1) * page_size
    next_rank_score = entries[mine.rank - 2].detection_power if mine and mine.rank > 1 else None
    my_stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == current_user.id, DaruGameStat.difficulty == difficulty)) if current_user and current_user.role == "USER" else None
    return DaruLeaderboardResponse(difficulty=difficulty, top_entries=entries[:3], entries=general_entries[offset:offset + page_size], my_entry=mine, my_best=record_response(my_stat) if my_stat else None, next_rank_score=next_rank_score, total=len(entries), page=current_page, page_size=page_size, total_pages=total_pages)


@router.get("/me", response_model=list[DaruGameRecord])
def my_records(current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> list[DaruGameRecord]:
    stats = db.scalars(select(DaruGameStat).where(DaruGameStat.user_id == current_user.id).order_by(DaruGameStat.difficulty)).all()
    return [record_response(stat) for stat in stats]


@router.get("/history", response_model=DaruGameHistoryResponse)
def history(current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)], difficulty: Annotated[Difficulty, Query()] = "EASY", page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=20)] = 5) -> DaruGameHistoryResponse:
    active = (DaruGamePlayRecord.user_id == current_user.id, DaruGamePlayRecord.difficulty == difficulty, DaruGamePlayRecord.deleted_at.is_(None))
    total = db.scalar(select(func.count()).select_from(DaruGamePlayRecord).where(*active)) or 0
    total_pages = max(1, (total + page_size - 1) // page_size)
    current_page = min(page, total_pages)
    records = db.scalars(select(DaruGamePlayRecord).where(*active).order_by(DaruGamePlayRecord.achieved_at.desc(), DaruGamePlayRecord.id.desc()).offset((current_page - 1) * page_size).limit(page_size)).all()
    stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == current_user.id, DaruGameStat.difficulty == difficulty))
    items = [DaruGameHistoryItem(id=item.id, difficulty=item.difficulty, detection_power=float(item.detection_power), attempts=item.attempts, elapsed_seconds=item.elapsed_seconds, max_combo=item.max_combo, hints_used=item.hints_used, earned_daru_points=item.earned_daru_points, completed=item.completed, within_time_limit=item.within_time_limit, achieved_at=item.achieved_at, deleted_at=None, is_best=bool(stat and item.completed and stat.best_achieved_at == item.achieved_at and stat.best_detection_power == item.detection_power and stat.best_attempts == item.attempts and stat.best_elapsed_seconds == item.elapsed_seconds), is_ranking_record=bool(stat and stat.ranking_record_id == item.id)) for item in records]
    protected_id = db.scalar(select(DaruGamePlayRecord.id).where(*active, DaruGamePlayRecord.id == stat.ranking_record_id)) if stat and stat.ranking_record_id else None
    best = db.scalar(best_record_query(current_user.id, difficulty).limit(1))
    stats = db.scalars(select(DaruGameStat).where(DaruGameStat.user_id == current_user.id)).all()
    has_deletable_best_any_difficulty = any(
        (candidate := db.scalar(best_record_query(current_user.id, item.difficulty).limit(1))) is not None
        and candidate.id != item.ranking_record_id
        for item in stats
    )
    protected_count = int(protected_id is not None)
    deletable_best_record_id = best.id if best and best.id != protected_id else None
    return DaruGameHistoryResponse(difficulty=difficulty, items=items, total=total, page=current_page, page_size=page_size, total_pages=total_pages, protected_count=protected_count, deletable_count=max(0, total - protected_count), deletable_best_record_id=deletable_best_record_id, has_deletable_best=deletable_best_record_id is not None, has_deletable_best_any_difficulty=has_deletable_best_any_difficulty)


@router.get("/history/trash", response_model=DaruGameHistoryResponse)
def trash_history(current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)], difficulty: Annotated[Difficulty, Query()] = "EASY", page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=20)] = 5) -> DaruGameHistoryResponse:
    deleted = (DaruGamePlayRecord.user_id == current_user.id, DaruGamePlayRecord.difficulty == difficulty, DaruGamePlayRecord.deleted_at.is_not(None))
    total = db.scalar(select(func.count()).select_from(DaruGamePlayRecord).where(*deleted)) or 0
    total_pages = max(1, (total + page_size - 1) // page_size)
    current_page = min(page, total_pages)
    records = db.scalars(select(DaruGamePlayRecord).where(*deleted).order_by(DaruGamePlayRecord.deleted_at.desc(), DaruGamePlayRecord.id.desc()).offset((current_page - 1) * page_size).limit(page_size)).all()
    stat = db.scalar(select(DaruGameStat).where(DaruGameStat.user_id == current_user.id, DaruGameStat.difficulty == difficulty))
    items = [DaruGameHistoryItem(id=item.id, difficulty=item.difficulty, detection_power=float(item.detection_power), attempts=item.attempts, elapsed_seconds=item.elapsed_seconds, max_combo=item.max_combo, hints_used=item.hints_used, earned_daru_points=item.earned_daru_points, completed=item.completed, within_time_limit=item.within_time_limit, achieved_at=item.achieved_at, deleted_at=item.deleted_at, is_best=False, is_ranking_record=bool(stat and stat.ranking_record_id == item.id)) for item in records]
    return DaruGameHistoryResponse(difficulty=difficulty, items=items, total=total, page=current_page, page_size=page_size, total_pages=total_pages)


@router.delete("/history/trash", response_model=DaruGameHistoryBatchDeleteResponse)
def empty_trash(difficulty: Annotated[Difficulty, Query()], current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameHistoryBatchDeleteResponse:
    return DaruGameHistoryBatchDeleteResponse(deleted_count=permanently_delete_trash(db, user_id=current_user.id, difficulty=difficulty))


@router.delete("/history/{record_id}", status_code=204)
def delete_history_record(record_id: int, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> Response:
    if soft_delete_play_record(db, user_id=current_user.id, record_id=record_id) is None:
        raise HTTPException(status_code=404, detail="Play record not found")
    return Response(status_code=204)


@router.post("/history/{record_id}/restore", status_code=204)
def restore_history_record(record_id: int, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> Response:
    if restore_play_record(db, user_id=current_user.id, record_id=record_id) is None:
        raise HTTPException(status_code=404, detail="Deleted play record not found")
    return Response(status_code=204)


@router.delete("/history/{record_id}/permanent", status_code=204)
def permanently_delete_history_record(record_id: int, current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> Response:
    if permanently_delete_play_record(db, user_id=current_user.id, record_id=record_id) is None:
        raise HTTPException(status_code=404, detail="Deleted play record not found")
    return Response(status_code=204)


@router.post("/history/delete", response_model=DaruGameHistoryBatchDeleteResponse)
def delete_selected_history(
    payload: DaruGameHistoryBatchDeleteInput,
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
) -> DaruGameHistoryBatchDeleteResponse:
    records = soft_delete_play_records(
        db,
        user_id=current_user.id,
        record_ids=payload.record_ids,
        difficulty=payload.difficulty,
        exclude_record_ids=payload.exclude_record_ids,
    )
    if records is None:
        raise HTTPException(status_code=404, detail="One or more play records were not found")
    return DaruGameHistoryBatchDeleteResponse(deleted_count=len(records))


@router.delete("/history", response_model=DaruGameHistoryBatchDeleteResponse)
def delete_history(current_user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> DaruGameHistoryBatchDeleteResponse:
    return DaruGameHistoryBatchDeleteResponse(deleted_count=soft_delete_all_play_records(db, user_id=current_user.id))
