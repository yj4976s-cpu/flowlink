from __future__ import annotations

import json
import logging
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User
from app.schemas.copilot import CopilotAction, CopilotCard, CopilotRequest, CopilotResponse, CopilotSuggestion
from app.services.copilot_providers import ChatStatus, ProviderNotConfiguredError, ProviderResponseError, create_chat_provider
from app.services.copilot_tools import execute_tool, tool_definitions
from app.repositories.detections import list_user_detection_events
from app.repositories.user_flow import list_lost_reports_for_user, list_matches_for_user, list_notifications_for_user
from app.services.copilot_memory import get_or_create, model_history, save_message, validated_context

logger = logging.getLogger(__name__)

ALLOWED_PATHS = {"/", "/guide", "/login", "/detect", "/found-items", "/map", "/lost-reports/new", "/matches", "/mypage", "/notifications", "/community", "/admin", "/admin/detections", "/admin/ownership-claims", "/admin/found-items", "/admin/map"}

PAGE_CONTEXT_PATHS = {
    "HOME": "/",
    "GUIDE": "/guide",
    "FOUND_ITEMS": "/found-items",
    "FOUND_ITEM_DETAIL": "/found-items",
    "LOST_REPORT_NEW": "/lost-reports/new",
    "LOST_REPORT_DETAIL": "/mypage",
    "MATCH_LIST": "/matches",
    "MATCH_DETAIL": "/matches",
    "OWNERSHIP_CLAIM": "/mypage",
    "ANALYSIS_DETAIL": "/detect",
    "NOTIFICATIONS": "/notifications",
    "MY_PAGE": "/mypage",
    "DETECTION": "/detect",
    "COMMUNITY": "/community",
    "ADMIN_DASHBOARD": "/admin",
    "ADMIN_DETECTIONS": "/admin/detections",
    "ADMIN_OWNERSHIP_CLAIMS": "/admin/ownership-claims",
    "ADMIN_FOUND_ITEMS": "/admin/found-items",
    "ADMIN_OPERATIONS": "/admin",
}

SYSTEM_PROMPT = """당신은 FlowLink AI Copilot이다. 한국어로 간결하고 정확하게 답한다.
FlowLink는 AI 탐지→발견물→시민 분실 신고→규칙 기반 자동 매칭→소유권 확인→관리자 확인→반환을 연결한다.
실제 사용자 상태를 추측하지 말고 필요한 경우에만 허용된 도구를 호출한다. 조회 결과가 없으면 없다고 말한다.
일반 인사나 서비스 설명에는 도구를 호출하지 않는다. 같은 요청에서 동일한 도구와 인자로 받은 결과가 충분하면 반복 호출하지 말고 최종 답변을 생성한다.
AI detection confidence는 이미지 객체 분류 신뢰도이며, match score는 신고 조건 유사도 점수다. 둘을 절대 확률처럼 섞지 않는다.
발견물이 사용자 소유라고 확정하지 말고 '유사한 후보이며 추가 확인이 필요하다'고 표현한다.
권한 없는 개인정보, 보관 상세 위치, 관리자 내부 메모를 노출하지 않는다. FlowLink 범위 밖 질문은 범위를 짧게 설명한다.
마지막 답변은 JSON 객체만 출력한다: {"message":string,"cards":[],"actions":[],"suggestions":[]}.
cards type은 MATCH, ANALYSIS, STATUS, TIMELINE, EVIDENCE, SYSTEM_NOTICE만 허용하며 필드는 title, subtitle, score, confidence, status, details, entity_id다.
중요한 개인화 답변은 가능하면 답변→근거(EVIDENCE)→행동 순서로 구성한다. EVIDENCE에는 도구에서 실제 확인된 신고·발견물·매칭·분석 식별자와 근거만 넣고 추측을 넣지 않는다.
신고 진행 상태를 설명할 때는 실제 완료된 단계와 현재 단계만 TIMELINE details에 넣고 미래 완료를 예측하지 않는다.
사용자가 자연어로 분실 내용을 말하면 자동 저장하지 말고 기억나는 정보로 신고 초안을 요약한 뒤, 부족한 정보를 질문하거나 NAVIGATE로 /lost-reports/new에 연결한다.
발견 위치를 묻고 실제 공개 가능한 위치가 있으면 위치를 설명하고 NAVIGATE로 /map 또는 /found-items에 연결한다. 정확한 비공개 보관 위치는 노출하지 않는다.
현재 context의 page와 entity_id가 있으면 짧은 후속 질문도 해당 entity 기준으로 해석하되, 도구 결과 없이 값을 만들어내지 않는다.
actions type은 NAVIGATE 또는 ASK만 허용한다. NAVIGATE target은 서버가 허용한 FlowLink 경로만 사용한다. ASK target은 후속 질문 문장이다.
suggestions는 현재 답변과 직접 관련된 후속 질문만 id와 message로 최대 5개 제안한다. 관련 질문이 적으면 억지로 채우지 않는다."""


def _mode(user: User | None) -> str:
    return "OPERATIONS" if user and user.role == "ADMIN" else "PERSONAL" if user else "GUIDE"


def _tool_free_greeting(message: str) -> bool:
    normalized = message.strip().lower().rstrip("!?.~ ")
    return normalized in {"안녕", "안녕하세요", "반가워", "반가워요", "hello", "hi"}


def _model_context(db: Session, request: CopilotRequest, user: User | None) -> tuple[str, str, int | None]:
    """Build model context only from server-known page names and owned entities."""
    requested_page = request.context.page if request.context.page in PAGE_CONTEXT_PATHS else "GENERAL"
    context_type, entity_id = "GENERAL", None
    if user is not None:
        context_type, entity_id = validated_context(db, user, requested_page, request.context.entity_id)
    if requested_page in {"FOUND_ITEM_DETAIL", "LOST_REPORT_DETAIL", "MATCH_DETAIL", "OWNERSHIP_CLAIM", "ANALYSIS_DETAIL"} and context_type == "GENERAL":
        requested_page = "GENERAL"
    canonical_path = PAGE_CONTEXT_PATHS.get(requested_page, "/")
    role = user.role if user else "GUEST"
    value = f"mode={_mode(user)}, role={role}, page={requested_page}, path={canonical_path}, context_type={context_type}, entity_id={entity_id or 'none'}"
    return value, context_type, entity_id


def create_copilot_briefing(db: Session, current_user: User) -> CopilotResponse:
    if current_user.role == "ADMIN":
        return CopilotResponse(message="운영 현황은 질문을 통해 현재 데이터를 안전하게 조회할 수 있어요.", mode="OPERATIONS", provider="flowlink", model="briefing", actions=[CopilotAction(type="NAVIGATE", label="운영 대시보드", target="/admin")])
    reports = list(list_lost_reports_for_user(db, current_user.id, skip=0, limit=10))
    matches = list(list_matches_for_user(db, current_user.id, skip=0, limit=10))
    notifications = list(list_notifications_for_user(db, current_user.id, skip=0, limit=20, unread_only=True))
    analyses = list(list_user_detection_events(db, user_id=current_user.id, skip=0, limit=5))
    new_matches = sum(1 for item in notifications if item.notification_type == "MATCH_FOUND")
    active_reports = sum(1 for item in reports if item.status != "RESOLVED")
    cards: list[CopilotCard] = []
    completed = next((event for event in analyses if event.status == "COMPLETED" and event.detected_objects), None)
    if completed:
        detected = max(completed.detected_objects, key=lambda item: item.confidence)
        cards.append(CopilotCard(type="ANALYSIS", title=detected.object_class.name_ko, subtitle="최근 내 AI 분석 결과", confidence=float(detected.confidence), status=completed.status, details=[f"분석 #{completed.id}"], entity_id=completed.id))
    if matches:
        top = matches[0]
        cards.append(CopilotCard(type="MATCH", title=top.found_item.object_class.name_ko, subtitle=f"{top.found_item.area_name} · 현재 조건 기준 상위 후보", score=int(top.total_score), status=top.status, details=["매칭 점수는 신고 조건 유사도입니다."], entity_id=top.id))
    summary = f"새 매칭 {new_matches}건 · 진행 중인 신고 {active_reports}건"
    message = f"새로 확인할 내용이 있어요.\n{summary}" if new_matches else f"현재 새로 확인할 매칭 결과는 없어요.\n{summary}"
    actions = [CopilotAction(type="NAVIGATE", label="내 신고", target="/mypage"), CopilotAction(type="NAVIGATE", label="내 매칭", target="/matches"), CopilotAction(type="NAVIGATE", label="발견물 찾기", target="/found-items")]
    return CopilotResponse(message=message, cards=cards[:2], actions=actions, suggestions=[], mode="PERSONAL", provider="flowlink", model="briefing",)


def _safe_response(raw: str, *, user: User | None, model: str, provider: str) -> CopilotResponse:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"message": raw, "cards": [], "actions": []}
    if not isinstance(data, dict):
        data = {"message": raw, "cards": [], "actions": [], "suggestions": []}
    cards: list[CopilotCard] = []
    raw_cards = data.get("cards", [])
    for item in (raw_cards if isinstance(raw_cards, list) else [])[:5]:
        try: cards.append(CopilotCard.model_validate(item))
        except (ValueError, TypeError): continue
    actions: list[CopilotAction] = []
    raw_actions = data.get("actions", [])
    for item in (raw_actions if isinstance(raw_actions, list) else [])[:5]:
        try:
            action = CopilotAction.model_validate(item)
            if action.type == "NAVIGATE" and action.target.split("?", 1)[0] not in ALLOWED_PATHS: continue
            actions.append(action)
        except (ValueError, TypeError): continue
    suggestions: list[CopilotSuggestion] = []
    seen: set[str] = set()
    blocked = ("관리자", "다른 사용자", "전체 사용자") if not user or user.role != "ADMIN" else ()
    if user is None:
        blocked += ("내 신고 상태", "내 매칭", "내 알림", "내 소유권")
    raw_suggestions = data.get("suggestions", [])
    if not isinstance(raw_suggestions, list):
        raw_suggestions = []
    for index, item in enumerate(raw_suggestions[:10]):
        try:
            raw_message = item.get("message") if isinstance(item, dict) else item
            if not isinstance(raw_message, str):
                continue
            message = raw_message.strip()
            if not message or len(message) > 160 or message in seen or any(term in message for term in blocked):
                continue
            raw_id = item.get("id") if isinstance(item, dict) else None
            suggestion_id = raw_id.strip() if isinstance(raw_id, str) and raw_id.strip() else f"follow-up-{index + 1}"
            suggestions.append(CopilotSuggestion(id=suggestion_id[:80], message=message))
            seen.add(message)
            if len(suggestions) == 5:
                break
        except (ValueError, TypeError):
            continue
    message = str(data.get("message") or "답변을 생성하지 못했습니다.")[:4000]
    return CopilotResponse(message=message, cards=cards, actions=actions, suggestions=suggestions, mode=_mode(user), provider=provider, model=model)


async def create_copilot_response(db: Session, request: CopilotRequest, current_user: User | None) -> CopilotResponse:
    settings = get_settings()
    context, context_type, context_entity_id = _model_context(db, request, current_user)
    conversation = None
    current_text = request.messages[-1].content
    if current_user:
        conversation = get_or_create(
            db, current_user, request.conversation_public_id, current_text,
            context_type, context_entity_id
        )
        save_message(
            db, conversation, "USER", current_text, client_id=request.client_message_id
        )
        db.commit()
        input_items = model_history(db, conversation)
    else:
        input_items = [{"role": item.role, "content": item.content} for item in request.messages[-12:]]
    try:
        provider = create_chat_provider(settings)
        logger.info(
            "Chat provider: %s; Gemini configured: %s; model: %s",
            settings.CHAT_MODEL_PROVIDER.lower(),
            bool(settings.GEMINI_API_KEY),
            settings.GEMINI_MODEL if settings.CHAT_MODEL_PROVIDER.lower() == "gemini" else settings.OPENAI_MODEL,
        )
        result = await provider.generate(
            messages=input_items,
            instructions=f"{SYSTEM_PROMPT}\n현재 context: {context}",
            tools=[] if _tool_free_greeting(current_text) else tool_definitions(current_user.role if current_user else None),
            execute=lambda name, arguments: execute_tool(db, current_user, name, arguments),
        )
    except ProviderNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="FlowLink AI 연결 설정을 확인하고 있어요. 잠시 후 다시 시도해 주세요.") from exc
    except ProviderResponseError as exc:
        if exc.status == ChatStatus.RATE_LIMITED:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "status": ChatStatus.RATE_LIMITED.value,
                    "message": "AI 사용량이 잠시 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
                },
            ) from exc
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI 응답을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.") from exc
    response = _safe_response(result.text, user=current_user, model=result.model, provider=result.provider)
    if conversation:
        presentation = {
            "cards": [item.model_dump(mode="json") for item in response.cards],
            "actions": [item.model_dump(mode="json") for item in response.actions],
            "suggestions": [item.model_dump(mode="json") for item in response.suggestions],
        }
        save_message(db, conversation, "ASSISTANT", response.message, presentation=presentation)
        db.commit()
        response.conversation_public_id = conversation.public_id
    return response
