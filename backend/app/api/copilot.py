from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, get_optional_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.copilot import CopilotConversationDetail, CopilotConversationSummary, CopilotConversationUpdate, CopilotRequest, CopilotResponse
from app.services.copilot import create_copilot_briefing, create_copilot_response, rate_limited_fallback_response
from app.services.copilot_memory import detail, rename, soft_delete, summaries
from app.services.copilot_rate_limit import copilot_rate_limiter, rate_limit_identity, role_limit
from app.core.config import get_settings

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


@router.get("/briefing", response_model=CopilotResponse, summary="FlowLink AI 개인 브리핑")
def briefing(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]) -> CopilotResponse:
    return create_copilot_briefing(db, current_user)

@router.get("/conversations", response_model=list[CopilotConversationSummary])
def conversations(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)], skip: int = 0, limit: int = 15):
    return summaries(db,current_user,max(0,skip),max(1,min(limit,20)))

@router.get("/conversations/{public_id}", response_model=CopilotConversationDetail)
def conversation(public_id:str,current_user:Annotated[User,Depends(get_current_user)],db:Annotated[Session,Depends(get_db)]):
    result=detail(db,current_user,public_id)
    if not result: raise HTTPException(404,"대화를 찾을 수 없습니다.")
    return result

@router.patch("/conversations/{public_id}", response_model=CopilotConversationSummary)
def update_conversation(public_id:str,payload:CopilotConversationUpdate,current_user:Annotated[User,Depends(get_current_user)],db:Annotated[Session,Depends(get_db)]):
    row=rename(db,current_user,public_id,payload.title)
    if not row: raise HTTPException(404,"대화를 찾을 수 없습니다.")
    return CopilotConversationSummary.model_validate(row,from_attributes=True)

@router.delete("/conversations/{public_id}",status_code=204)
def delete_conversation(public_id:str,current_user:Annotated[User,Depends(get_current_user)],db:Annotated[Session,Depends(get_db)]):
    if not soft_delete(db,current_user,public_id): raise HTTPException(404,"대화를 찾을 수 없습니다.")
    return Response(status_code=204)


@router.post("/chat", response_model=CopilotResponse, summary="FlowLink AI Copilot 대화")
async def chat(
    request: Request,
    payload: CopilotRequest,
    current_user: Annotated[User | None, Depends(get_optional_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CopilotResponse:
    settings = get_settings()
    role, limiter_key = rate_limit_identity(current_user, request.client.host if request.client else None)
    if not copilot_rate_limiter.allow(
        limiter_key,
        limit=role_limit(settings, role),
        window_seconds=settings.COPILOT_RATE_LIMIT_WINDOW_SECONDS,
    ):
        if current_user is not None:
            return rate_limited_fallback_response(current_user)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"status": "RATE_LIMITED", "message": "요청이 잠시 많아요. 잠시 후 다시 시도해 주세요."},
            headers={"Retry-After": str(settings.COPILOT_RATE_LIMIT_WINDOW_SECONDS)},
        )
    try:
        return await create_copilot_response(db, payload, current_user)
    except ValueError as exc:
        if str(exc) == "conversation_not_found":
            raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.") from exc
        raise
