from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import require_internal_api_key
from app.schemas.runtime import RuntimeModelRollbackRequest, RuntimeModelStatusResponse, RuntimeModelSwitchRequest, RuntimeModelSwitchResponse
from app.services.model_runtime_manager import (
    ModelRuntimeConflictError,
    ModelRuntimeError,
    ModelRuntimeNotFoundError,
    ModelRuntimeValidationError,
    get_model_runtime_manager,
)

router = APIRouter(prefix="/api/runtime/models", tags=["runtime"])


@router.get("/status", response_model=RuntimeModelStatusResponse, summary="Active model runtime status")
def model_status(
    _: Annotated[None, Depends(require_internal_api_key)],
) -> RuntimeModelStatusResponse:
    return get_model_runtime_manager().status()


@router.post("/activate", response_model=RuntimeModelSwitchResponse, summary="Activate a registered model")
def activate_model(
    _: Annotated[None, Depends(require_internal_api_key)],
    request: RuntimeModelSwitchRequest,
) -> RuntimeModelSwitchResponse:
    try:
        return get_model_runtime_manager().activate(
            model_id=request.model_id,
            expected_active_model_id=request.expected_active_model_id,
            request_id=request.request_id,
        )
    except ModelRuntimeNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model is not registered") from exc
    except ModelRuntimeConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Model switch conflict") from exc
    except ModelRuntimeValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Model validation failed") from exc
    except ModelRuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Model service is unavailable") from exc


@router.post("/rollback", response_model=RuntimeModelSwitchResponse, summary="Rollback to the previous active model")
def rollback_model(
    _: Annotated[None, Depends(require_internal_api_key)],
    request: RuntimeModelRollbackRequest,
) -> RuntimeModelSwitchResponse:
    try:
        return get_model_runtime_manager().rollback(
            expected_active_model_id=request.expected_active_model_id,
            request_id=request.request_id,
        )
    except ModelRuntimeConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Model switch conflict") from exc
    except ModelRuntimeValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Model validation failed") from exc
    except ModelRuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Model service is unavailable") from exc
