from __future__ import annotations
from uuid import uuid4
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload
from app.core.security import utc_now
from app.models import CopilotConversation, CopilotMessage, CopilotMessageRef, DetectionEvent, FoundItem, LostReport, MatchCandidate, OwnershipClaim, User
from app.schemas.copilot import CopilotConversationDetail, CopilotConversationSummary, CopilotStoredMessage

MODEL_HISTORY_LIMIT = 8

CONTEXT_TYPES = {
    "LOST_REPORT_DETAIL": "LOST_REPORT",
    "MATCH_DETAIL": "MATCH",
    "OWNERSHIP_CLAIM": "OWNERSHIP_CLAIM",
    "FOUND_ITEM_DETAIL": "FOUND_ITEM",
    "ANALYSIS_DETAIL": "ANALYSIS",
}

def _entity_allowed(db: Session, user_id: int, ref_type: str, ref_id: int) -> bool:
    if ref_type == "LOST_REPORT":
        return db.scalar(select(LostReport.id).where(LostReport.id == ref_id, LostReport.user_id == user_id)) is not None
    if ref_type == "MATCH":
        return db.scalar(select(MatchCandidate.id).join(LostReport).where(MatchCandidate.id == ref_id, LostReport.user_id == user_id)) is not None
    if ref_type in {"OWNERSHIP_CLAIM", "CLAIM"}:
        return db.scalar(select(OwnershipClaim.id).where(OwnershipClaim.id == ref_id, OwnershipClaim.user_id == user_id)) is not None
    if ref_type == "ANALYSIS":
        return db.scalar(select(DetectionEvent.id).where(DetectionEvent.id == ref_id, DetectionEvent.user_id == user_id)) is not None
    if ref_type == "FOUND_ITEM":
        return db.scalar(select(FoundItem.id).where(FoundItem.id == ref_id)) is not None
    return False

def validated_context(db: Session, user: User, page: str, entity_id: int | None) -> tuple[str, int | None]:
    context_type = CONTEXT_TYPES.get(page, "GENERAL")
    if context_type == "GENERAL" or entity_id is None or not _entity_allowed(db, user.id, context_type, entity_id):
        return "GENERAL", None
    return context_type, entity_id

def _owned(db: Session, user: User, public_id: str) -> CopilotConversation | None:
    return db.scalar(select(CopilotConversation).where(CopilotConversation.public_id == public_id, CopilotConversation.user_id == user.id, CopilotConversation.deleted_at.is_(None)))

def get_or_create(db: Session, user: User, public_id: str | None, first_text: str, context_type: str, entity_id: int | None) -> CopilotConversation:
    conversation = _owned(db, user, public_id) if public_id else None
    if public_id and conversation is None: raise ValueError("conversation_not_found")
    if conversation: return conversation
    now = utc_now(); title = first_text.strip().replace("\n", " ")[:60] or "FlowLink AI 대화"
    conversation = CopilotConversation(public_id=str(uuid4()), user_id=user.id, title=title, context_type=context_type, context_entity_id=entity_id, created_at=now, updated_at=now, last_message_at=now)
    db.add(conversation); db.flush(); return conversation

def save_message(db: Session, conversation: CopilotConversation, role: str, content: str, *, client_id: str | None = None, presentation: dict | None = None) -> CopilotMessage:
    if client_id:
        existing = db.scalar(select(CopilotMessage).where(CopilotMessage.conversation_id == conversation.id, CopilotMessage.client_message_id == client_id))
        if existing: return existing
    now=utc_now(); message=CopilotMessage(conversation_id=conversation.id, role=role, content=content, presentation_type="TEXT", presentation=presentation, client_message_id=client_id, created_at=now)
    db.add(message); conversation.last_message_at=now; conversation.updated_at=now; db.flush()
    if presentation:
        for card in presentation.get("cards", []):
            ref_type = card.get("type", "")
            ref_id = card.get("entity_id")
            if ref_id is not None and _entity_allowed(db, conversation.user_id, ref_type, int(ref_id)):
                db.add(CopilotMessageRef(message_id=message.id, ref_type=ref_type, ref_id=int(ref_id)))
    return message

def model_history(db: Session, conversation: CopilotConversation) -> list[dict[str,str]]:
    rows=list(db.scalars(select(CopilotMessage).where(CopilotMessage.conversation_id == conversation.id).order_by(CopilotMessage.id.desc()).limit(MODEL_HISTORY_LIMIT)).all())
    return [{"role":"assistant" if row.role == "ASSISTANT" else "user", "content":row.content} for row in reversed(rows)]

def summaries(db: Session, user: User, skip: int, limit: int) -> list[CopilotConversationSummary]:
    rows=db.scalars(select(CopilotConversation).where(CopilotConversation.user_id==user.id,CopilotConversation.deleted_at.is_(None)).order_by(CopilotConversation.last_message_at.desc(),CopilotConversation.id.desc()).offset(skip).limit(limit)).all()
    return [CopilotConversationSummary.model_validate(row,from_attributes=True) for row in rows]

def conversation_count(db: Session, user: User) -> int:
    return db.scalar(select(func.count()).select_from(CopilotConversation).where(CopilotConversation.user_id == user.id, CopilotConversation.deleted_at.is_(None))) or 0

def detail(db: Session,user:User,public_id:str)->CopilotConversationDetail|None:
    row=db.scalar(select(CopilotConversation).options(selectinload(CopilotConversation.messages)).where(CopilotConversation.public_id==public_id,CopilotConversation.user_id==user.id,CopilotConversation.deleted_at.is_(None)))
    if not row:return None
    messages=[]
    for item in sorted(row.messages,key=lambda value:value.id):
        data=item.presentation or {}
        messages.append(CopilotStoredMessage(id=item.id,role=item.role,content=item.content,cards=data.get("cards",[]),actions=data.get("actions",[]),suggestions=data.get("suggestions",[]),created_at=item.created_at))
    return CopilotConversationDetail(public_id=row.public_id,title=row.title,context_type=row.context_type,context_entity_id=row.context_entity_id,last_message_at=row.last_message_at,messages=messages)

def rename(db:Session,user:User,public_id:str,title:str)->CopilotConversation|None:
    row=_owned(db,user,public_id)
    if row: row.title=title.strip();row.updated_at=utc_now();db.commit()
    return row

def soft_delete(db:Session,user:User,public_id:str)->bool:
    row=_owned(db,user,public_id)
    if not row:return False
    row.deleted_at=utc_now();db.commit();return True

def soft_delete_all(db: Session, user: User) -> int:
    now = utc_now()
    result = db.execute(update(CopilotConversation).where(CopilotConversation.user_id == user.id, CopilotConversation.deleted_at.is_(None)).values(deleted_at=now, updated_at=now))
    db.commit()
    return result.rowcount or 0
