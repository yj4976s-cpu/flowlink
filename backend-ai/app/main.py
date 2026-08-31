from fastapi import FastAPI, Response, status

from app.api.router import api_router
from app.core.config import get_settings
from app.services.model_runtime_manager import ModelRuntimeError, get_model_runtime_manager

settings = get_settings()

app = FastAPI(
    title="FlowLink AI API",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)
app.include_router(api_router)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "flowlink-ai", "version": "0.1.0"}


@app.get("/ready", tags=["system"])
def ready(response: Response) -> dict[str, str | bool | None]:
    try:
        runtime_status = get_model_runtime_manager().status(verify_ready=True)
    except ModelRuntimeError:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "error", "service": "flowlink-ai", "active_model_id": None, "model_ready": False}
    return {
        "status": "ok" if runtime_status.model_ready else "error",
        "service": "flowlink-ai",
        "active_model_id": runtime_status.active_model_id,
        "model_ready": runtime_status.model_ready,
    }
