from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.security import utc_now
from app.models import FoundItem, LostReport, MatchCandidate, OwnershipClaim, User
from app.repositories.user_flow import get_admin_dashboard_data, list_lost_reports_for_user, list_matches_for_user, list_notifications_for_user
from app.repositories.detections import list_user_detection_events
from app.services.mappers import detection_event_response, lost_report_response, match_candidate_response, notification_response


USER_TOOL_NAMES = {"get_my_lost_reports", "get_my_matches", "get_match_detail", "get_my_analysis_results", "get_my_ownership_claims", "get_my_notifications"}
ADMIN_TOOL_NAMES = {"get_operations_summary"}
KST = ZoneInfo("Asia/Seoul")


def tool_definitions(role: str | None) -> list[dict]:
    if role == "USER":
        return [
            {"type": "function", "name": "get_my_lost_reports", "description": "로그인 USER가 본인의 분실 신고 목록이나 처리 상태를 명시적으로 질문할 때만 조회한다. 일반 인사와 서비스 사용법 질문에는 사용하지 않는다.", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}}, "additionalProperties": False}},
            {"type": "function", "name": "get_my_matches", "description": "현재 로그인 USER의 분실 신고와 연결된 매칭 후보를 사용자가 명시적으로 묻는 경우에만 조회한다. 일반 인사나 서비스 안내에는 사용하지 않는다. 점수는 소유 확률이 아니라 조건 유사도다.", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}}, "additionalProperties": False}},
            {"type": "function", "name": "get_match_detail", "description": "로그인 USER가 특정 match_id의 추천 이유나 점수 근거를 명시적으로 질문할 때만 본인 범위에서 조회한다.", "parameters": {"type": "object", "properties": {"match_id": {"type": "integer", "minimum": 1}}, "required": ["match_id"], "additionalProperties": False}},
            {"type": "function", "name": "get_my_analysis_results", "description": "로그인 USER가 본인의 AI 분석 결과나 객체 분류 신뢰도를 명시적으로 질문할 때만 조회한다.", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}}, "additionalProperties": False}},
            {"type": "function", "name": "get_my_ownership_claims", "description": "로그인 USER가 본인의 소유권 확인 요청이나 처리 상태를 명시적으로 질문할 때만 조회한다.", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}}, "additionalProperties": False}},
            {"type": "function", "name": "get_my_notifications", "description": "로그인 USER가 본인의 최근 알림이나 읽지 않은 알림을 명시적으로 질문할 때만 조회한다. 일반 인사에는 사용하지 않는다.", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}, "unread_only": {"type": "boolean"}}, "additionalProperties": False}},
        ]
    if role == "ADMIN":
        return [{"type": "function", "name": "get_operations_summary", "description": "관리자가 확인할 오늘의 탐지, 발견물, 매칭, 소유권 요청 운영 집계를 조회한다.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}]
    return []


def _limit(arguments: dict) -> int:
    return max(1, min(int(arguments.get("limit", 5)), 10))


def operations_today_since(now: datetime) -> datetime:
    today_kst = now.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    return today_kst.astimezone(UTC)


def _user_ownership_claim_payload(claim: OwnershipClaim) -> dict:
    """Project only owner-visible fields before data reaches an LLM provider."""
    return {
        "id": claim.id,
        "found_item_id": claim.found_item_id,
        "lost_report_id": claim.lost_report_id,
        "status": claim.status,
        "verification_details": claim.verification_details,
        "reviewed_at": claim.reviewed_at.isoformat() if claim.reviewed_at else None,
        "created_at": claim.created_at.isoformat(),
    }


def execute_tool(db: Session, current_user: User | None, name: str, arguments: dict) -> dict | list:
    role = current_user.role if current_user else None
    if name in USER_TOOL_NAMES and role != "USER":
        return {"error": "이 도구는 로그인한 일반 사용자 본인에게만 허용됩니다."}
    if name in ADMIN_TOOL_NAMES and role != "ADMIN":
        return {"error": "관리자 권한이 필요합니다."}
    if name == "get_my_lost_reports":
        return [lost_report_response(item).model_dump(mode="json") for item in list_lost_reports_for_user(db, current_user.id, skip=0, limit=_limit(arguments))]
    if name == "get_my_matches":
        return [match_candidate_response(item).model_dump(mode="json") for item in list_matches_for_user(db, current_user.id, skip=0, limit=_limit(arguments))]
    if name == "get_match_detail":
        match_id = int(arguments["match_id"])
        item = db.scalar(select(MatchCandidate).join(MatchCandidate.lost_report).options(joinedload(MatchCandidate.lost_report).joinedload(LostReport.object_class), joinedload(MatchCandidate.found_item).joinedload(FoundItem.object_class), joinedload(MatchCandidate.found_item).joinedload(FoundItem.detected_object), joinedload(MatchCandidate.found_item).selectinload(FoundItem.citizen_reports)).where(MatchCandidate.id == match_id, LostReport.user_id == current_user.id))
        if item is None:
            return {"error": "본인에게 허용된 매칭 후보를 찾을 수 없습니다."}
        payload = match_candidate_response(item).model_dump(mode="json")
        payload["score_explanation"] = {"item_type": item.type_score, "area": item.area_score, "time": item.time_score, "features": item.keyword_score, "notice": "각 점수는 신고 조건 유사도이며 소유 확률이 아닙니다."}
        return payload
    if name == "get_my_notifications":
        items = list_notifications_for_user(db, current_user.id, skip=0, limit=_limit(arguments), unread_only=bool(arguments.get("unread_only", False)))
        return [notification_response(item).model_dump(mode="json") for item in items]
    if name == "get_my_analysis_results":
        items = list_user_detection_events(db, user_id=current_user.id, skip=0, limit=_limit(arguments))
        return [detection_event_response(item).model_dump(mode="json") for item in items]
    if name == "get_my_ownership_claims":
        items = db.scalars(select(OwnershipClaim).options(joinedload(OwnershipClaim.lost_report).joinedload(LostReport.object_class), joinedload(OwnershipClaim.found_item).joinedload(FoundItem.object_class)).where(OwnershipClaim.user_id == current_user.id).order_by(OwnershipClaim.created_at.desc()).limit(_limit(arguments))).all()
        return [_user_ownership_claim_payload(item) for item in items]
    if name == "get_operations_summary":
        now = utc_now()
        since = operations_today_since(now)
        data = get_admin_dashboard_data(db, since=since, period="today", now=now)
        allowed = ("summary", "kpis", "status_counts", "claim_status_counts", "average_confidence")
        return {key: data[key] for key in allowed if key in data}
    return {"error": "허용되지 않은 도구입니다."}
