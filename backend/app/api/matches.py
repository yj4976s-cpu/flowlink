from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import require_user
from app.db.session import get_db
from app.models import User
from app.repositories.user_flow import list_matches_for_user
from app.schemas.match import MatchCandidateResponse
from app.services.mappers import match_candidate_response

router = APIRouter(prefix="/api/matches", tags=["matches"])


@router.get("/me", response_model=list[MatchCandidateResponse], summary="내 매칭 목록 조회")
def list_my_matches(
    current_user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[MatchCandidateResponse]:
    matches = list_matches_for_user(db, current_user.id, skip=skip, limit=limit)
    return [match_candidate_response(match) for match in matches]
