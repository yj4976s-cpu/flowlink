from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models import AiModelDeploymentEvent, User
from app.schemas.admin import (
    AdminModelDeploymentEventResponse,
    AdminModelDeploymentSwitchResponse,
    AdminModelDeploymentStatusResponse,
)
from app.services.ai_inference_client import AIInferenceClient, AIInferenceRejectedError, AIInferenceUnavailableError


SAFE_RUNTIME_ERROR = "모델 서비스 상태를 확인할 수 없습니다."
SAFE_SWITCH_UNAVAILABLE = "모델 서비스에 연결할 수 없습니다."
SAFE_SWITCH_VALIDATION = "후보 모델 검증에 실패했습니다."
SAFE_SWITCH_CONFLICT = "화면의 활성 모델 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요."
SAFE_MODEL_NOT_FOUND = "등록되지 않은 모델입니다."


def utc_now() -> datetime:
    return datetime.now(UTC)


def get_model_deployment_status(ai_client: AIInferenceClient) -> AdminModelDeploymentStatusResponse:
    try:
        payload = ai_client.get_model_deployment_status()
        payload["status_source"] = "runtime"
        return AdminModelDeploymentStatusResponse.model_validate(payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SAFE_RUNTIME_ERROR) from exc


def list_model_deployment_history(db: Session, *, limit: int = 20) -> list[AdminModelDeploymentEventResponse]:
    events = db.scalars(
        select(AiModelDeploymentEvent)
        .options(joinedload(AiModelDeploymentEvent.requester))
        .order_by(AiModelDeploymentEvent.requested_at.desc(), AiModelDeploymentEvent.id.desc())
        .limit(limit)
    ).all()
    return [_event_response(event) for event in events]


def activate_model(
    db: Session,
    *,
    admin: User,
    ai_client: AIInferenceClient,
    model_id: str,
    expected_active_model_id: str | None,
    request_id: str,
) -> AdminModelDeploymentSwitchResponse:
    return _switch_model(
        db,
        admin=admin,
        ai_client=ai_client,
        action="ACTIVATE",
        requested_model_id=model_id,
        expected_active_model_id=expected_active_model_id,
        request_id=request_id,
    )


def rollback_model(
    db: Session,
    *,
    admin: User,
    ai_client: AIInferenceClient,
    expected_active_model_id: str | None,
    request_id: str,
) -> AdminModelDeploymentSwitchResponse:
    return _switch_model(
        db,
        admin=admin,
        ai_client=ai_client,
        action="ROLLBACK",
        requested_model_id=None,
        expected_active_model_id=expected_active_model_id,
        request_id=request_id,
    )


def _switch_model(
    db: Session,
    *,
    admin: User,
    ai_client: AIInferenceClient,
    action: str,
    requested_model_id: str | None,
    expected_active_model_id: str | None,
    request_id: str,
) -> AdminModelDeploymentSwitchResponse:
    existing = db.scalar(select(AiModelDeploymentEvent).where(AiModelDeploymentEvent.request_id == request_id))
    if existing is not None and existing.status == "SUCCEEDED" and existing.to_model_id:
        return AdminModelDeploymentSwitchResponse(
            changed=False,
            previous_model_id=existing.from_model_id,
            active_model_id=existing.to_model_id,
            active_classes=[],
            switched_at=existing.completed_at or existing.requested_at,
            model_ready=True,
            audit_event=_event_response(existing),
        )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 처리 중이거나 실패한 모델 전환 요청입니다.")

    now = utc_now()
    event = AiModelDeploymentEvent(
        requested_by=admin.id,
        request_id=request_id,
        action=action,
        requested_model_id=requested_model_id,
        from_model_id=expected_active_model_id,
        status="REQUESTED",
        requested_at=now,
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 처리된 모델 전환 요청입니다.") from exc
    db.refresh(event)

    try:
        if action == "ACTIVATE":
            if requested_model_id is None:
                raise ValueError("model id is required")
            payload = ai_client.activate_model(
                model_id=requested_model_id,
                expected_active_model_id=expected_active_model_id,
                request_id=request_id,
            )
        else:
            payload = ai_client.rollback_model(
                expected_active_model_id=expected_active_model_id,
                request_id=request_id,
            )
    except AIInferenceUnavailableError as exc:
        _mark_failed(db, event, "MODEL_SERVICE_UNAVAILABLE")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SAFE_SWITCH_UNAVAILABLE) from exc
    except AIInferenceRejectedError as exc:
        failure_code = {
            404: "MODEL_NOT_REGISTERED",
            409: "MODEL_SWITCH_CONFLICT",
            422: "MODEL_VALIDATION_FAILED",
        }.get(exc.status_code, "MODEL_SWITCH_REJECTED")
        _mark_failed(db, event, failure_code)
        if exc.status_code == 404:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=SAFE_MODEL_NOT_FOUND) from exc
        if exc.status_code == 409:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=SAFE_SWITCH_CONFLICT) from exc
        if exc.status_code == 422:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=SAFE_SWITCH_VALIDATION) from exc
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SAFE_SWITCH_UNAVAILABLE) from exc
    except Exception as exc:
        _mark_failed(db, event, "MODEL_SWITCH_FAILED")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SAFE_SWITCH_UNAVAILABLE) from exc

    active_model_id = payload.get("active_model_id")
    if not isinstance(active_model_id, str) or not active_model_id:
        _mark_failed(db, event, "INVALID_MODEL_SERVICE_RESPONSE")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SAFE_SWITCH_UNAVAILABLE)
    previous_model_id = payload.get("previous_model_id")
    event.status = "SUCCEEDED"
    event.failure_code = None
    event.from_model_id = previous_model_id if isinstance(previous_model_id, str) else expected_active_model_id
    event.to_model_id = active_model_id
    event.completed_at = utc_now()
    db.commit()
    db.refresh(event)
    return AdminModelDeploymentSwitchResponse(
        changed=bool(payload.get("changed")),
        previous_model_id=event.from_model_id,
        active_model_id=active_model_id,
        active_classes=list(payload.get("active_classes") or []),
        switched_at=event.completed_at or utc_now(),
        model_ready=bool(payload.get("model_ready", True)),
        audit_event=_event_response(event),
    )


def _mark_failed(db: Session, event: AiModelDeploymentEvent, failure_code: str) -> None:
    event.status = "FAILED"
    event.failure_code = failure_code
    event.completed_at = utc_now()
    db.commit()


def _event_response(event: AiModelDeploymentEvent) -> AdminModelDeploymentEventResponse:
    return AdminModelDeploymentEventResponse(
        id=event.id,
        requested_by=event.requested_by,
        requester_email=event.requester.email if event.requester is not None else None,
        action=event.action,
        requested_model_id=event.requested_model_id,
        from_model_id=event.from_model_id,
        to_model_id=event.to_model_id,
        status=event.status,
        failure_code=event.failure_code,
        requested_at=event.requested_at,
        completed_at=event.completed_at,
    )
