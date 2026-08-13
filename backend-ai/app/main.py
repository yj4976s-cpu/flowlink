from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import get_settings

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
