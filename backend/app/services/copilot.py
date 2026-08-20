from __future__ import annotations

import json
import logging
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User
from app.schemas.copilot import CopilotAction, CopilotCard, CopilotRequest, CopilotResponse, CopilotSuggestion
from app.services.copilot_providers import ChatStatus, ProviderNotConfiguredError, ProviderResponseError, create_chat_provider
from app.services.copilot_tools import execute_tool, search_public_community, tool_definitions_for_message
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
cards type은 MATCH, ANALYSIS, STATUS, TIMELINE, EVIDENCE, SYSTEM_NOTICE, COMMUNITY만 허용하며 필드는 title, subtitle, score, confidence, status, details, entity_id다.
중요한 개인화 답변은 가능하면 답변→근거(EVIDENCE)→행동 순서로 구성한다. EVIDENCE에는 도구에서 실제 확인된 신고·발견물·매칭·분석 식별자와 근거만 넣고 추측을 넣지 않는다.
신고 진행 상태를 설명할 때는 실제 완료된 단계와 현재 단계만 TIMELINE details에 넣고 미래 완료를 예측하지 않는다.
사용자가 자연어로 분실 내용을 말하면 자동 저장하지 말고 기억나는 정보로 신고 초안을 요약한 뒤, 부족한 정보를 질문하거나 NAVIGATE로 /lost-reports/new에 연결한다.
발견 위치를 묻고 실제 공개 가능한 위치가 있으면 위치를 설명하고 NAVIGATE로 /map 또는 /found-items에 연결한다. 정확한 비공개 보관 위치는 노출하지 않는다.
현재 context의 page와 entity_id가 있으면 짧은 후속 질문도 해당 entity 기준으로 해석하되, 도구 결과 없이 값을 만들어내지 않는다.
actions type은 NAVIGATE 또는 ASK만 허용한다. NAVIGATE target은 서버가 허용한 FlowLink 경로만 사용한다. ASK target은 후속 질문 문장이다.
suggestions는 현재 답변과 직접 관련된 후속 질문만 id와 message로 최대 5개 제안한다. 관련 질문이 적으면 억지로 채우지 않는다."""


TEAM_MEMBERS = [
    {
        "name": "고태영",
        "tags": "DATASET · PRESENTATION",
        "roles": {"dataset", "presentation"},
        "duties": [
            "Roboflow 데이터 수집 및 정제",
            "객체 데이터 라벨링",
            "발표 자료 제작",
        ],
    },
    {
        "name": "홍진욱",
        "tags": "DATASET · PRESENTATION",
        "roles": {"dataset", "presentation"},
        "duties": [
            "Roboflow 데이터 수집 및 정제",
            "객체 데이터 라벨링",
            "발표 자료 구성 및 제작",
        ],
    },
    {
        "name": "유진설",
        "tags": "FULL STACK · AI SERVICE",
        "roles": {"fullstack", "ai"},
        "duties": [
            "사용자 서비스 Frontend · Backend 개발",
            "AI 이미지·영상 탐지 서비스 연동",
            "발견물·분실 신고 매칭 기능 개발",
            "알림 기능 개발",
            "Backend와 Backend AI 연동 흐름 정리",
        ],
    },
    {
        "name": "조정화",
        "tags": "FULL STACK · ADMIN SERVICE",
        "roles": {"fullstack", "admin"},
        "duties": [
            "Frontend UI 및 테마 개발",
            "사용자/관리자 서비스 화면 개발",
            "관리자 대시보드 및 운영 기능 개발",
            "인증, DB, API 연동",
            "전체 서비스 통합 보조",
        ],
    },
]

TEAM_GENERAL_KEYWORDS = (
    "팀원",
    "업무분담",
    "업무 분담",
    "분담표",
    "팀역할",
    "팀 역할",
)
TEAM_ROLE_KEYWORDS = {
    "dataset": ("데이터셋", "라벨링", "roboflow", "로보플로우"),
    "presentation": ("발표", "발표자료", "발표 자료", "ppt"),
    "ai": ("ai서비스", "ai 서비스", "ai 담당", "backend ai", "백엔드 ai"),
    "admin": ("관리자서비스", "관리자 서비스", "관리자 담당"),
}


def _mode(user: User | None) -> str:
    return "OPERATIONS" if user and user.role == "ADMIN" else "PERSONAL" if user else "GUIDE"


def _presentation(response: CopilotResponse) -> dict[str, list[dict[str, object]]]:
    return {
        "cards": [item.model_dump(mode="json") for item in response.cards],
        "actions": [item.model_dump(mode="json") for item in response.actions],
        "suggestions": [item.model_dump(mode="json") for item in response.suggestions],
    }


def _team_role_response(text: str, user: User | None) -> CopilotResponse | None:
    normalized = text.strip().casefold()
    compact = "".join(normalized.split())
    if not normalized:
        return None

    selected_members = [
        member
        for member in TEAM_MEMBERS
        if member["name"].casefold() in normalized
    ]
    matched_roles = {
        role
        for role, keywords in TEAM_ROLE_KEYWORDS.items()
        if any(keyword.casefold() in normalized or keyword.casefold() in compact for keyword in keywords)
    }
    if not selected_members and matched_roles:
        selected_members = [
            member
            for member in TEAM_MEMBERS
            if member["roles"] & matched_roles
        ]

    has_general_intent = any(keyword in normalized or keyword in compact for keyword in TEAM_GENERAL_KEYWORDS)
    if not selected_members and not matched_roles and not has_general_intent:
        return None
    if not selected_members:
        selected_members = TEAM_MEMBERS

    lines = ["FlowLink 팀원 업무 분담은 이렇게 정리되어 있어요."]
    for member in selected_members:
        duties = ", ".join(member["duties"])
        lines.append(f"- {member['name']} — {member['tags']}\n  {duties}을 담당했어요.")

    return CopilotResponse(
        message="\n\n".join(lines),
        cards=[],
        actions=[],
        suggestions=[
            CopilotSuggestion(id="team-dataset", message="데이터셋 담당 누구야?"),
            CopilotSuggestion(id="team-ai", message="AI 서비스 담당 누구야?"),
            CopilotSuggestion(id="team-admin", message="관리자 서비스 담당 누구야?"),
        ],
        mode=_mode(user),
        provider="flowlink",
        model="local-team-roles",
    )


def _tool_free_greeting(message: str) -> bool:
    normalized = message.strip().lower().rstrip("!?.~ ")
    return normalized in {"안녕", "안녕하세요", "반가워", "반가워요", "hello", "hi"}


def _local_greeting_response(user: User) -> CopilotResponse:
    if user.role == "ADMIN":
        message = "안녕하세요. 운영 현황, 탐지 결과, 소유권 요청 검토가 필요하면 바로 도와드릴게요."
        suggestions = [
            CopilotSuggestion(id="admin-summary", message="오늘 운영 현황 요약해줘"),
            CopilotSuggestion(id="admin-claims", message="소유권 요청 검토 흐름 알려줘"),
        ]
    else:
        message = "안녕하세요. 내 신고, 매칭 후보, 알림이 궁금하면 필요한 정보만 확인해서 도와드릴게요."
        suggestions = [
            CopilotSuggestion(id="my-matches", message="내 매칭 결과 알려줘"),
            CopilotSuggestion(id="my-reports", message="내 분실 신고 상태 알려줘"),
        ]
    return CopilotResponse(message=message, cards=[], actions=[], suggestions=suggestions, mode=_mode(user), provider="flowlink", model="local-greeting")


def rate_limited_fallback_response(user: User) -> CopilotResponse:
    if user.role == "ADMIN":
        suggestions = [
            CopilotSuggestion(id="admin-summary-local", message="운영 현황은 어디서 확인해?"),
            CopilotSuggestion(id="admin-claims-local", message="소유권 요청 검토 화면으로 안내해줘"),
        ]
    else:
        suggestions = [
            CopilotSuggestion(id="my-reports-local", message="내 신고는 어디서 확인해?"),
            CopilotSuggestion(id="my-matches-local", message="매칭 후보는 어디서 봐?"),
        ]
    return CopilotResponse(
        message="AI 연결이나 사용량이 잠시 불안정해요. 잠시 후 다시 질문해 주세요. 지금은 FlowLink 화면 이동과 기본 안내를 도와드릴게요.",
        cards=[],
        actions=[
            CopilotAction(type="NAVIGATE", label="마이페이지", target="/mypage"),
            CopilotAction(type="NAVIGATE", label="이용 안내", target="/guide"),
        ],
        suggestions=suggestions,
        mode=_mode(user),
        provider="flowlink",
        model="local-rate-limit",
    )


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


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _community_cards(items: list[dict]) -> list[CopilotCard]:
    cards: list[CopilotCard] = []
    labels = {
        "FIELD_STORY": "목격 제보",
        "QUESTION": "도움 요청",
        "EXPERIENCE": "반환·이용 경험",
        "OPINION": "자유 이야기",
    }
    for item in items:
        details = [f"분류: {labels.get(str(item.get('category')), '커뮤니티')}"]
        if item.get("place_name"):
            details.append(f"장소: {item['place_name']}")
        if item.get("comment_count") is not None:
            details.append(f"댓글 {item['comment_count']}개")
        if item.get("href"):
            details.append(str(item["href"]))
        cards.append(
            CopilotCard(
                type="COMMUNITY",
                title=str(item.get("title") or "커뮤니티 글"),
                subtitle=str(item.get("content_excerpt") or "사용자가 공유한 참고 정보입니다."),
                details=details,
                entity_id=item.get("id") if isinstance(item.get("id"), int) else None,
            )
        )
    return cards


def _guest_community_response(db: Session, *, category: str, empty_message: str) -> CopilotResponse:
    items = search_public_community(db, category=category, limit=3)
    if not items:
        return CopilotResponse(
            message=empty_message,
            cards=[],
            actions=[CopilotAction(type="NAVIGATE", label="커뮤니티 보기", target="/community")],
            suggestions=[],
            mode="GUIDE",
            provider="flowlink",
            model="guest-guide",
        )
    label = "자유 이야기" if category == "OPINION" else "목격 제보"
    return CopilotResponse(
        message=f"최근 {label}를 가져왔어요. 커뮤니티 글은 사용자가 공유한 참고 정보이며, 공식 발견물이나 소유권 확인 근거는 아닙니다.",
        cards=_community_cards(items),
        actions=[CopilotAction(type="NAVIGATE", label="커뮤니티에서 보기", target="/community")],
        suggestions=[],
        mode="GUIDE",
        provider="flowlink",
        model="guest-guide",
    )


def _guest_response(db: Session, request: CopilotRequest) -> CopilotResponse:
    text = request.messages[-1].content.strip().lower()
    team_response = _team_role_response(text, None)
    if team_response is not None:
        return team_response

    common_actions = [
        CopilotAction(type="NAVIGATE", label="이용 안내", target="/guide"),
        CopilotAction(type="NAVIGATE", label="발견물 보기", target="/found-items"),
        CopilotAction(type="NAVIGATE", label="로그인", target="/login"),
    ]
    if _contains_any(text, ("자유", "의견", "사람들이", "opinion")):
        return _guest_community_response(db, category="OPINION", empty_message="아직 최근 자유 이야기가 없어요. 커뮤니티에서 사용자가 공유한 참고 정보를 확인해보세요.")
    if _contains_any(text, ("목격", "제보", "field", "story")):
        return _guest_community_response(db, category="FIELD_STORY", empty_message="아직 최근 목격 제보가 없어요. 커뮤니티는 사용자가 공유한 참고 정보를 모아 보여줍니다.")
    if _contains_any(text, ("커뮤니티", "community")):
        return CopilotResponse(
            message="커뮤니티는 시민이 목격 제보, 도움 요청, 반환·이용 경험, 자유 이야기를 나누는 공간이에요. 공식 발견물 목록이나 소유권 확정 정보는 아니니 참고 정보로 봐주세요.",
            cards=[],
            actions=[CopilotAction(type="NAVIGATE", label="커뮤니티 보기", target="/community")],
            suggestions=[CopilotSuggestion(id="recent-opinion", message="최근 자유 이야기 보여줘"), CopilotSuggestion(id="recent-field-story", message="최근 목격 제보 있어?")],
            mode="GUIDE",
            provider="flowlink",
            model="guest-guide",
        )
    if _contains_any(text, ("분실", "신고", "lost")):
        return CopilotResponse(
            message="분실 신고는 로그인 후 등록할 수 있어요. 물품 종류, 색상, 특징, 잃어버린 것으로 추정되는 위치와 시간을 입력하면 공개 발견물과 비교하는 흐름으로 이어집니다.",
            cards=[],
            actions=[CopilotAction(type="NAVIGATE", label="로그인하기", target="/login"), CopilotAction(type="NAVIGATE", label="분실 신고 안내", target="/guide")],
            suggestions=[],
            mode="GUIDE",
            provider="flowlink",
            model="guest-guide",
        )
    if _contains_any(text, ("발견물", "찾기", "found")):
        return CopilotResponse(
            message="공개 발견물은 누구나 확인할 수 있어요. 종류, 색상, 대략적인 발견 구역을 살펴보되 정확한 보관 장소나 비공개 확인 정보는 공개되지 않습니다.",
            cards=[],
            actions=[CopilotAction(type="NAVIGATE", label="발견물 보기", target="/found-items")],
            suggestions=[],
            mode="GUIDE",
            provider="flowlink",
            model="guest-guide",
        )
    if _contains_any(text, ("지도", "map", "위치", "구역")):
        return CopilotResponse(
            message="지도에서는 공개 가능한 발견 위치를 대략적인 구역 수준으로 확인할 수 있어요. 개인정보와 보관 안전을 위해 정확한 보관 장소는 공개하지 않습니다.",
            cards=[],
            actions=[CopilotAction(type="NAVIGATE", label="지도 보기", target="/map")],
            suggestions=[],
            mode="GUIDE",
            provider="flowlink",
            model="guest-guide",
        )
    if _contains_any(text, ("ai", "탐지", "detect")):
        return CopilotResponse(
            message="AI 탐지는 수면 위 객체 후보를 찾아 분류와 매칭을 돕는 기능이에요. AI가 실제 소유자나 동일 물품을 확정하지는 않고, 최종 확인은 관리자 검토를 거칩니다.",
            cards=[],
            actions=[CopilotAction(type="NAVIGATE", label="AI 탐지 보기", target="/detect")],
            suggestions=[],
            mode="GUIDE",
            provider="flowlink",
            model="guest-guide",
        )
    if _contains_any(text, ("소유권", "반환", "ownership", "claim")):
        return CopilotResponse(
            message="소유권 확인 요청은 로그인 후 매칭 후보에서 진행할 수 있어요. 자동 매칭 점수는 참고 정보이고, 최종 승인과 반환 처리는 관리자 검토를 거칩니다.",
            cards=[],
            actions=[CopilotAction(type="NAVIGATE", label="로그인하기", target="/login"), CopilotAction(type="NAVIGATE", label="이용 안내", target="/guide")],
            suggestions=[],
            mode="GUIDE",
            provider="flowlink",
            model="guest-guide",
        )
    return CopilotResponse(
        message="안녕하세요. FlowLink는 AI 수면 부유 객체 탐지, 공개 발견물 조회, 시민 분실 신고, 관리자 확인과 반환 흐름을 연결하는 서비스예요. 로그인하면 내 신고, 매칭, 알림 같은 개인 기능도 확인할 수 있습니다.",
        cards=[],
        actions=common_actions,
        suggestions=[
            CopilotSuggestion(id="found-items", message="발견물은 어디서 확인해?"),
            CopilotSuggestion(id="lost-report", message="분실 신고는 어떻게 해?"),
            CopilotSuggestion(id="community", message="커뮤니티는 어떤 공간이야?"),
        ],
        mode="GUIDE",
        provider="flowlink",
        model="guest-guide",
    )


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


def _decode_response_object(raw: str) -> dict | None:
    candidate = raw.strip()
    if candidate.startswith("```") and candidate.endswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3:
            candidate = "\n".join(lines[1:-1]).strip()

    # Providers occasionally return the object as a JSON-encoded string.
    # Decode at most twice so structured fields do not appear as chat text.
    for _ in range(2):
        try:
            decoded = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            return None
        if isinstance(decoded, dict):
            return decoded
        if not isinstance(decoded, str):
            return None
        candidate = decoded.strip()
    return None


def _safe_response(raw: str, *, user: User | None, model: str, provider: str) -> CopilotResponse:
    data = _decode_response_object(raw)
    if data is None:
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
    if current_user is None:
        return _guest_response(db, request)
    if current_user:
        conversation = get_or_create(
            db, current_user, request.conversation_public_id, current_text,
            context_type, context_entity_id
        )
        save_message(
            db, conversation, "USER", current_text, client_id=request.client_message_id
        )
        db.commit()
        team_response = _team_role_response(current_text, current_user)
        if team_response is not None:
            save_message(db, conversation, "ASSISTANT", team_response.message, presentation=_presentation(team_response))
            db.commit()
            team_response.conversation_public_id = conversation.public_id
            logger.info("copilot_local_response type=team_roles mode=%s provider_calls=0", team_response.mode)
            return team_response
        if _tool_free_greeting(current_text):
            response = _local_greeting_response(current_user)
            save_message(db, conversation, "ASSISTANT", response.message, presentation=_presentation(response))
            db.commit()
            response.conversation_public_id = conversation.public_id
            logger.info("copilot_local_response type=greeting mode=%s provider_calls=0", response.mode)
            return response
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
            tools=tool_definitions_for_message(current_user.role if current_user else None, current_text),
            execute=lambda name, arguments: execute_tool(db, current_user, name, arguments),
        )
    except ProviderNotConfiguredError:
        response = rate_limited_fallback_response(current_user)
        if conversation is not None:
            presentation = {
                "cards": [item.model_dump(mode="json") for item in response.cards],
                "actions": [item.model_dump(mode="json") for item in response.actions],
                "suggestions": [item.model_dump(mode="json") for item in response.suggestions],
            }
            save_message(db, conversation, "ASSISTANT", response.message, presentation=presentation)
            db.commit()
            response.conversation_public_id = conversation.public_id
        logger.info("copilot_local_response type=provider_not_configured mode=%s", response.mode)
        return response
    except ProviderResponseError as exc:
        response = rate_limited_fallback_response(current_user)
        if conversation is not None:
            presentation = {
                "cards": [item.model_dump(mode="json") for item in response.cards],
                "actions": [item.model_dump(mode="json") for item in response.actions],
                "suggestions": [item.model_dump(mode="json") for item in response.suggestions],
            }
            save_message(db, conversation, "ASSISTANT", response.message, presentation=presentation)
            db.commit()
            response.conversation_public_id = conversation.public_id
        logger.info(
            "copilot_local_response type=%s mode=%s retry_after=%s",
            "provider_rate_limited" if exc.status == ChatStatus.RATE_LIMITED else "provider_unavailable",
            response.mode,
            exc.retry_after_seconds or settings.COPILOT_PROVIDER_COOLDOWN_SECONDS,
        )
        return response
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
