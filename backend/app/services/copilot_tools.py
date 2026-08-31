from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.security import utc_now
from app.models import CommunityComment, CommunityPost, DetectedObject, FoundItem, LostReport, MatchCandidate, OwnershipClaim, User
from app.repositories.detections import list_user_detection_events
from app.repositories.user_flow import get_admin_dashboard_data, list_lost_reports_for_user, list_matches_for_user, list_notifications_for_user
USER_TOOL_NAMES = {
    "get_my_lost_reports",
    "get_my_matches",
    "get_match_detail",
    "get_my_analysis_results",
    "get_my_ownership_claims",
    "get_my_notifications",
    "search_public_community",
}
ADMIN_TOOL_NAMES = {"get_operations_summary", "get_operations_queue"}
COMMUNITY_CATEGORIES = {"FIELD_STORY", "QUESTION", "EXPERIENCE", "OPINION"}
KST = ZoneInfo("Asia/Seoul")
OPERATIONS_PENDING_TASKS = (
    ("operation_detection_pending", "AI 탐지 검토 대기", "/admin/detections"),
    ("waste_collection_pending", "폐기물 수거 대기", "/admin/detections?followUp=WASTE_PENDING"),
    ("citizen_review_pending", "시민 제보 검토 대기", "/admin/citizen-reports?status=PENDING"),
    ("ownership_claim_pending", "소유권 요청 검토 대기", "/admin/ownership-claims?status=PENDING"),
    ("ownership_return_pending", "승인 후 실제 반환 대기", "/admin/ownership-claims?status=APPROVED"),
)


def tool_definitions(role: str | None) -> list[dict]:
    if role == "USER":
        return [
            {
                "type": "function",
                "name": "get_my_lost_reports",
                "description": "로그인 USER가 본인의 분실 신고 목록이나 처리 상태를 명시적으로 질문할 때만 조회한다.",
                "parameters": {
                    "type": "object",
                    "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}},
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "get_my_matches",
                "description": "로그인 USER가 본인의 분실 신고와 연결된 매칭 후보를 명시적으로 질문할 때만 조회한다. 점수는 소유 확률이 아니다.",
                "parameters": {
                    "type": "object",
                    "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}},
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "get_match_detail",
                "description": "로그인 USER가 특정 match_id의 추천 이유와 점수 근거를 명시적으로 질문할 때만 본인 범위에서 조회한다.",
                "parameters": {
                    "type": "object",
                    "properties": {"match_id": {"type": "integer", "minimum": 1}},
                    "required": ["match_id"],
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "get_my_analysis_results",
                "description": "로그인 USER가 본인의 AI 분석 결과와 객체 분류 신뢰도를 명시적으로 질문할 때만 조회한다.",
                "parameters": {
                    "type": "object",
                    "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}},
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "get_my_ownership_claims",
                "description": "로그인 USER가 본인의 소유권 확인 요청이나 처리 상태를 명시적으로 질문할 때만 조회한다.",
                "parameters": {
                    "type": "object",
                    "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}},
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "get_my_notifications",
                "description": "로그인 USER가 본인의 최근 알림이나 읽지 않은 알림을 명시적으로 질문할 때만 조회한다. 일반 인사에는 사용하지 않는다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "limit": {"type": "integer", "minimum": 1, "maximum": 10},
                        "unread_only": {"type": "boolean"},
                    },
                    "additionalProperties": False,
                },
            },
            {
                "type": "function",
                "name": "search_public_community",
                "description": "공개 커뮤니티 글에서 사용자 공유 참고 정보를 검색한다. 공식 발견물 또는 소유권 확정 정보가 아니며 공개 projection만 반환한다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "category": {"type": "string", "enum": ["FIELD_STORY", "QUESTION", "EXPERIENCE", "OPINION"]},
                        "place": {"type": "string"},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 5},
                    },
                    "additionalProperties": False,
                },
            },
        ]
    if role == "ADMIN":
        return [
            {
                "type": "function",
                "name": "get_operations_summary",
                "description": "\uad00\ub9ac\uc790\uac00 \uc6b4\uc601 \ud604\ud669, AI \ud0d0\uc9c0 \uc218, \uacf5\uc2dd \ubc1c\uacac\ubb3c, \ub9e4\uce6d, \uc18c\uc720\uad8c \uc694\uccad, \ubc18\ud658 \uc644\ub8cc, \ud604\uc7ac \ub0a8\uc740 \uc6b4\uc601 \ub300\uae30 \uc5c5\ubb34 \ub4f1 \uc548\uc804\ud55c \uc9d1\uacc4\ub9cc \uba85\uc2dc\uc801\uc73c\ub85c \ubb3c\uc744 \ub54c \uc870\ud68c\ud55c\ub2e4.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
            {
                "type": "function",
                "name": "get_operations_queue",
                "description": "\uad00\ub9ac\uc790\uac00 \uc9c0\uae08 \ucc98\ub9ac\ud574\uc57c \ud560 \uc6b4\uc601 \ub300\uae30\uc5f4\uacfc \uc774\ub3d9\ud560 \uad00\ub9ac\uc790 \ud654\uba74\uc744 \uba85\uc2dc\uc801\uc73c\ub85c \ubb3c\uc744 \ub54c \uc870\ud68c\ud55c\ub2e4. \uc0c1\ud0dc \ubcc0\uacbd\uc740 \uc218\ud589\ud558\uc9c0 \uc54a\ub294\ub2e4.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        ]
    return []


def tool_definitions_for_message(role: str | None, message: str) -> list[dict]:
    definitions = tool_definitions(role)
    if not definitions:
        return definitions

    text = message.strip().lower()
    if role == "ADMIN":
        selected: set[str] = set()
        if any(keyword in text for keyword in (
            "\uc6b4\uc601", "\ud604\ud669", "\uc694\uc57d", "\uc9d1\uacc4", "\ud1b5\uacc4", "\ud3c9\uade0", "\uc2e0\ub8b0\ub3c4", "confidence",
            "\ud0d0\uc9c0 \uac74\uc218", "\ubc1c\uacac\ubb3c", "\ub9e4\uce6d", "\uc18c\uc720\uad8c", "\ubc18\ud658", "\ubd84\uc2e4 \uc2e0\uace0", "\ud074\ub798\uc2a4",
        )):
            selected.add("get_operations_summary")
        if any(keyword in text for keyword in (
            "\ub300\uae30", "\ucc98\ub9ac", "\uc6b0\uc120", "queue", "\uac80\ud1a0", "\ud3d0\uae30\ubb3c", "\uc218\uac70", "\uc81c\ubcf4",
            "\uc18c\uc720\uad8c \uc694\uccad", "\ubc18\ud658 \ub300\uae30", "\ud560 \uc77c", "\ud574\uc57c", "\uc5c5\ubb34",
        )):
            selected.add("get_operations_queue")
        return [item for item in definitions if item["name"] in selected]

    if role != "USER":
        return definitions

    selected: set[str] = set()
    if any(keyword in text for keyword in ("신고", "분실", "lost report", "lost_report", "내 물건")):
        selected.add("get_my_lost_reports")
    if any(keyword in text for keyword in ("매칭", "후보", "match", "matched")):
        selected.update({"get_my_matches", "get_match_detail"})
    if any(keyword in text for keyword in ("탐지", "분석", "ai", "객체", "detect", "detection")):
        selected.add("get_my_analysis_results")
    if any(keyword in text for keyword in ("소유권", "claim", "반환 요청", "확인 요청")):
        selected.add("get_my_ownership_claims")
    if any(keyword in text for keyword in ("알림", "notification", "읽지 않은", "읽지않은")):
        selected.add("get_my_notifications")
    if any(keyword in text for keyword in ("커뮤니티", "목격", "제보", "자유 이야기", "이야기", "community")):
        selected.add("search_public_community")

    if not selected:
        return definitions
    return [item for item in definitions if item["name"] in selected]


def _limit(arguments: dict) -> int:
    return max(1, min(int(arguments.get("limit", 5)), 10))


def _community_limit(arguments: dict) -> int:
    return max(1, min(int(arguments.get("limit", 5)), 5))


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


def _object_payload(object_class: object | None) -> dict:
    return {
        "code": getattr(object_class, "code", None),
        "name_ko": getattr(object_class, "name_ko", None),
    }


def _lost_report_payload(report: LostReport) -> dict:
    description = report.description.strip()
    return {
        "id": report.id,
        "status": report.status,
        "item_type": _object_payload(report.object_class),
        "colors": report.colors or ([report.color] if report.color else []),
        "lost_location": report.area_name,
        "lost_time": {
            "from": report.lost_from.isoformat(),
            "to": report.lost_to.isoformat() if report.lost_to else None,
        },
        "feature_summary": description[:180] + ("..." if len(description) > 180 else ""),
    }


def _match_payload(candidate: MatchCandidate, *, include_breakdown: bool = False) -> dict:
    found_item = candidate.found_item
    payload = {
        "id": candidate.id,
        "status": candidate.status,
        "total_score": candidate.total_score,
        "found_item": {
            "id": found_item.id,
            "item_type": _object_payload(found_item.object_class),
            "area": found_item.area_name,
            "status": found_item.status,
            "found_at": found_item.found_at.isoformat(),
        },
    }
    if include_breakdown:
        payload["score_explanation"] = {
            "item_type": candidate.type_score,
            "area": candidate.area_score,
            "time": candidate.time_score,
            "features": candidate.keyword_score,
            "notice": "각 점수는 신고 조건 유사도이며 소유 확률이 아닙니다.",
        }
    return payload


def _notification_payload(notification) -> dict:
    return {
        "id": notification.id,
        "type": notification.notification_type,
        "title": notification.title,
        "message": notification.message,
        "related_type": notification.related_type,
        "related_id": notification.related_id,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
        "created_at": notification.created_at.isoformat(),
    }


def _detection_payload(event) -> dict:
    objects = sorted(event.detected_objects, key=lambda item: float(item.confidence), reverse=True)[:3]
    return {
        "id": event.id,
        "status": event.status,
        "source_type": event.source_type,
        "created_at": event.created_at.isoformat(),
        "detected_objects": [
            {
                "class_code": item.object_class.code,
                "class_name_ko": item.object_class.name_ko,
                "confidence": float(item.confidence),
            }
            for item in objects
        ],
    }


def _community_projection(post: CommunityPost, comment_count: int) -> dict:
    """Expose only public community fields that are safe to send to an LLM."""
    content = post.content.strip()
    return {
        "id": post.id,
        "category": post.category,
        "title": post.title,
        "content_excerpt": content[:180] + ("..." if len(content) > 180 else ""),
        "place_name": post.place_name,
        "comment_count": comment_count,
        "created_at": post.created_at.isoformat(),
        "href": f"/community/{post.id}",
    }


def search_public_community(
    db: Session,
    *,
    query: str | None = None,
    category: str | None = None,
    place: str | None = None,
    limit: int = 5,
) -> list[dict]:
    comment_count = (
        select(func.count(CommunityComment.id))
        .where(CommunityComment.post_id == CommunityPost.id, CommunityComment.deleted_at.is_(None))
        .correlate(CommunityPost)
        .scalar_subquery()
    )
    statement = select(CommunityPost, comment_count.label("comment_count")).where(CommunityPost.deleted_at.is_(None))
    if category:
        normalized = category.strip().upper()
        if normalized in COMMUNITY_CATEGORIES:
            statement = statement.where(CommunityPost.category == normalized)
    if query and query.strip():
        pattern = f"%{query.strip()}%"
        statement = statement.where(
            or_(CommunityPost.title.ilike(pattern), CommunityPost.content.ilike(pattern), CommunityPost.place_name.ilike(pattern))
        )
    if place and place.strip():
        pattern = f"%{place.strip()}%"
        statement = statement.where(or_(CommunityPost.place_name.ilike(pattern), CommunityPost.address.ilike(pattern)))
    rows = db.execute(statement.order_by(CommunityPost.created_at.desc()).limit(max(1, min(limit, 5)))).all()
    return [_community_projection(post, int(count or 0)) for post, count in rows]


def _operations_summary_payload(data: dict) -> dict:
    metrics = data.get("metrics") if isinstance(data.get("metrics"), dict) else {}
    average_confidence = data.get("average_confidence")
    pending_tasks = [
        {
            "code": code,
            "label": label,
            "pending_count": int(metrics.get(code) or 0),
            "path": path,
        }
        for code, label, path in OPERATIONS_PENDING_TASKS
    ]
    return {
        "period": data.get("period"),
        "counts": {
            "today_ai_detections": int(metrics.get("ai_detections") or 0),
            "official_found_items": int(metrics.get("official_found_items") or 0),
            "matches": int(metrics.get("matched") or 0),
            "ownership_claims": int(metrics.get("claims") or 0),
            "approved": int(metrics.get("approved") or 0),
            "returned": int(metrics.get("returned") or 0),
            "lost_reports": int(metrics.get("lost_reports") or 0),
        },
        "current_backlog": {
            "items": pending_tasks,
            "notice": "대기 업무는 오늘 생성 건수가 아니라 현재 남아 있는 관리자 처리 backlog이다.",
        },
        "average_detection_confidence": float(average_confidence) if average_confidence is not None else None,
        "class_detection_counts": [
            {
                "code": str(item.get("code") or ""),
                "name": str(item.get("name") or item.get("name_ko") or ""),
                "count": int(item.get("count") or 0),
            }
            for item in data.get("category_counts", [])
            if isinstance(item, dict)
        ],
        "ownership_claim_status_counts": [
            {"status": str(item.get("status") or ""), "count": int(item.get("count") or 0)}
            for item in data.get("claim_status_counts", [])
            if isinstance(item, dict)
        ],
        "notice": "집계는 운영 판단을 돕는 통계이며, 탐지 신뢰도나 매칭 점수를 소유 확률처럼 표현하지 않는다.",
    }


def _operations_queue_payload(data: dict) -> dict:
    metrics = data.get("metrics") if isinstance(data.get("metrics"), dict) else {}
    return {
        "items": [
            {
                "code": code,
                "label": label,
                "pending_count": int(metrics.get(code) or 0),
                "path": path,
            }
            for code, label, path in OPERATIONS_PENDING_TASKS
        ],
        "notice": "\uc774 \ub3c4\uad6c\ub294 \ub300\uae30\uc5f4 \uc870\ud68c \uc804\uc6a9\uc774\uba70 \uc2b9\uc778, \uac70\uc808, \uc0ad\uc81c, \uc218\uac70 \uc644\ub8cc \uac19\uc740 \uc0c1\ud0dc \ubcc0\uacbd\uc744 \uc218\ud589\ud558\uc9c0 \uc54a\ub294\ub2e4.",
    }


def execute_tool(db: Session, current_user: User | None, name: str, arguments: dict) -> dict | list:
    role = current_user.role if current_user else None
    if name in USER_TOOL_NAMES and role != "USER":
        return {"error": "이 도구는 로그인한 일반 사용자 본인에게만 허용됩니다."}
    if name in ADMIN_TOOL_NAMES and role != "ADMIN":
        return {"error": "관리자 권한이 필요합니다."}
    if name == "get_my_lost_reports":
        return [_lost_report_payload(item) for item in list_lost_reports_for_user(db, current_user.id, skip=0, limit=_limit(arguments))]
    if name == "get_my_matches":
        return [_match_payload(item) for item in list_matches_for_user(db, current_user.id, skip=0, limit=_limit(arguments))]
    if name == "get_match_detail":
        match_id = int(arguments["match_id"])
        item = db.scalar(select(MatchCandidate).join(MatchCandidate.lost_report).options(joinedload(MatchCandidate.lost_report).joinedload(LostReport.object_class), joinedload(MatchCandidate.found_item).joinedload(FoundItem.object_class), joinedload(MatchCandidate.found_item).joinedload(FoundItem.detected_object).joinedload(DetectedObject.detection_event), joinedload(MatchCandidate.found_item).selectinload(FoundItem.citizen_reports)).where(MatchCandidate.id == match_id, LostReport.user_id == current_user.id))
        if item is None:
            return {"error": "본인에게 허용된 매칭 후보를 찾을 수 없습니다."}
        return _match_payload(item, include_breakdown=True)
    if name == "get_my_notifications":
        items = list_notifications_for_user(db, current_user.id, skip=0, limit=_limit(arguments), unread_only=bool(arguments.get("unread_only", False)))
        return [_notification_payload(item) for item in items]
    if name == "get_my_analysis_results":
        items = list_user_detection_events(db, user_id=current_user.id, skip=0, limit=_limit(arguments))
        return [_detection_payload(item) for item in items]
    if name == "get_my_ownership_claims":
        items = db.scalars(select(OwnershipClaim).options(joinedload(OwnershipClaim.lost_report).joinedload(LostReport.object_class), joinedload(OwnershipClaim.found_item).joinedload(FoundItem.object_class)).where(OwnershipClaim.user_id == current_user.id).order_by(OwnershipClaim.created_at.desc()).limit(_limit(arguments))).all()
        return [_user_ownership_claim_payload(item) for item in items]
    if name == "search_public_community":
        return search_public_community(
            db,
            query=arguments.get("query") if isinstance(arguments.get("query"), str) else None,
            category=arguments.get("category") if isinstance(arguments.get("category"), str) else None,
            place=arguments.get("place") if isinstance(arguments.get("place"), str) else None,
            limit=_community_limit(arguments),
        )
    if name == "get_operations_summary":
        now = utc_now()
        since = operations_today_since(now)
        data = get_admin_dashboard_data(db, since=since, period="today", now=now)
        return _operations_summary_payload(data)
    if name == "get_operations_queue":
        now = utc_now()
        since = operations_today_since(now)
        data = get_admin_dashboard_data(db, since=since, period="today", now=now)
        return _operations_queue_payload(data)
    return {"error": "허용되지 않은 도구입니다."}
