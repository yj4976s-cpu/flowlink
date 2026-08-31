from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import utc_now
from app.repositories.user_flow import get_admin_dashboard_data
from app.services.copilot_providers import ProviderNotConfiguredError, ProviderResponseError, create_chat_provider

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")

TASKS = (
    ("operation_detection_pending", "탐지 검토 대기", "/admin/detections"),
    ("waste_collection_pending", "폐기물 수거 대기", "/admin/detections?followUp=WASTE_PENDING"),
    ("citizen_review_pending", "시민 제보 검토 대기", "/admin/citizen-reports?status=PENDING"),
    ("ownership_claim_pending", "소유권 요청 검토 대기", "/admin/ownership-claims?status=PENDING"),
    ("ownership_return_pending", "승인 후 반환 대기", "/admin/ownership-claims?status=APPROVED"),
)


def _today_since(now: datetime) -> tuple[datetime, datetime]:
    today_kst = now.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    return today_kst.astimezone(UTC), now


def _decimal_or_none(value: object) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _confidence_text(value: Decimal | None) -> str:
    if value is None:
        return "집계 전"
    return f"{float(value) * 100:.1f}%"


def _task_rows(metrics: dict[str, int]) -> list[dict[str, object]]:
    return [
        {"key": key, "label": label, "count": int(metrics.get(key) or 0), "href": href}
        for key, label, href in TASKS
    ]


def _priority_task(tasks: list[dict[str, object]]) -> dict[str, object] | None:
    for task in tasks:
        if int(task["count"]) > 0:
            return task
    return None


def build_rule_based_summary(*, metrics: dict[str, int], average_confidence: Decimal | None, priority_task: dict[str, object] | None) -> str:
    total_waiting = sum(int(metrics.get(key) or 0) for key, _, _ in TASKS)
    confidence = _confidence_text(average_confidence)
    if total_waiting == 0:
        return f"오늘 운영 대기 작업은 없습니다. 평균 탐지 신뢰도는 {confidence}이며, 현재는 신규 접수와 알림 흐름을 가볍게 모니터링하면 됩니다."
    if priority_task is None:
        return f"오늘 확인이 필요한 운영 작업이 {total_waiting}건 있습니다. 평균 탐지 신뢰도는 {confidence}입니다."
    return (
        f"오늘 확인이 필요한 운영 작업은 총 {total_waiting}건입니다. "
        f"가장 먼저 {priority_task['label']} {priority_task['count']}건을 처리하는 것이 좋습니다. "
        f"평균 탐지 신뢰도는 {confidence}입니다."
    )


def _provider_status(settings: Settings) -> dict[str, object]:
    provider = settings.CHAT_MODEL_PROVIDER.strip().lower()
    model = settings.GEMINI_MODEL if provider == "gemini" else settings.OPENAI_MODEL if provider == "openai" else None
    gemini_configured = provider == "gemini" and bool(settings.GEMINI_API_KEY.strip())
    return {
        "provider": provider,
        "model": model,
        "gemini_configured": gemini_configured,
    }


def get_admin_operations_briefing_status(settings: Settings) -> dict[str, object]:
    status = _provider_status(settings)
    return {
        "provider": status["provider"],
        "model": status["model"],
        "gemini_configured": status["gemini_configured"],
        "gemini_connected": False,
        "fallback_used": not status["gemini_configured"],
        "fallback_reason": None if status["gemini_configured"] else "NOT_CONFIGURED",
    }


def _parse_provider_message(text: str) -> str | None:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text.strip() or None
    message = payload.get("message") if isinstance(payload, dict) else None
    return message.strip() if isinstance(message, str) and message.strip() else None


async def _generate_llm_summary(settings: Settings, briefing_data: dict[str, object]) -> tuple[str, str, str]:
    provider = create_chat_provider(settings)
    result = await provider.generate(
        messages=[{"role": "user", "content": json.dumps(briefing_data, ensure_ascii=False, default=str)}],
        instructions=(
            "FlowLink 관리자 운영 브리핑을 한국어 JSON으로만 작성하세요. "
            "반드시 {\"message\":\"...\"} 형식으로 답하고, 입력 데이터에 없는 사실은 만들지 마세요. "
            "1~2문장으로 오늘 대기 작업과 우선 처리 작업을 자연스럽게 요약하세요."
        ),
        tools=[],
        execute=lambda _name, _args: None,
    )
    message = _parse_provider_message(result.text)
    if not message:
        raise ProviderResponseError("Provider returned an empty briefing")
    return message, result.provider, result.model


async def create_admin_operations_briefing(db: Session, settings: Settings) -> dict[str, object]:
    now = utc_now()
    since, generated_at = _today_since(now)
    dashboard = get_admin_dashboard_data(db, since=since, period="today", now=now)
    metrics = dashboard["metrics"]
    average_confidence = _decimal_or_none(dashboard.get("average_confidence"))
    tasks = _task_rows(metrics)
    priority = _priority_task(tasks)
    status = _provider_status(settings)
    fallback_reason: str | None = None
    summary = build_rule_based_summary(metrics=metrics, average_confidence=average_confidence, priority_task=priority)
    provider = str(status["provider"])
    model = status["model"]
    gemini_connected = False
    fallback_used = True

    if status["gemini_configured"]:
        try:
            summary, provider, model = await _generate_llm_summary(
                settings,
                {
                    "metrics": {key: int(metrics.get(key) or 0) for key, _, _ in TASKS},
                    "average_confidence": str(average_confidence) if average_confidence is not None else None,
                    "priority_task": priority,
                    "generated_at": generated_at.isoformat(),
                },
            )
            gemini_connected = provider == "gemini"
            fallback_used = False
        except (ProviderNotConfiguredError, ProviderResponseError, json.JSONDecodeError):
            fallback_reason = "PROVIDER_UNAVAILABLE"
            logger.info("admin_operations_briefing_fallback reason=%s", fallback_reason)
        except Exception:  # pragma: no cover - provider SDK exceptions vary by version.
            fallback_reason = "PROVIDER_UNAVAILABLE"
            logger.info("admin_operations_briefing_fallback reason=%s", fallback_reason)
    else:
        fallback_reason = "NOT_CONFIGURED"

    return {
        "summary": summary,
        "generated_at": generated_at,
        "metrics": {
            "operation_detection_pending": int(metrics.get("operation_detection_pending") or 0),
            "waste_collection_pending": int(metrics.get("waste_collection_pending") or 0),
            "citizen_review_pending": int(metrics.get("citizen_review_pending") or 0),
            "ownership_claim_pending": int(metrics.get("ownership_claim_pending") or 0),
            "ownership_return_pending": int(metrics.get("ownership_return_pending") or 0),
            "average_confidence": average_confidence,
        },
        "priority_task": priority,
        "tasks": tasks,
        "provider": provider,
        "model": model,
        "gemini_configured": bool(status["gemini_configured"]),
        "gemini_connected": gemini_connected,
        "fallback_used": fallback_used,
        "fallback_reason": fallback_reason,
    }
