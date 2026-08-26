from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.api.router import api_router
from app.core.config import get_settings

settings = get_settings()
app = FastAPI(
    title="FlowLink API",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_frontend_origins,
    allow_origin_regex=(
        r"^https?://("
        r"localhost|127\.0\.0\.1|"
        r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
        r"192\.168\.\d{1,3}\.\d{1,3}|"
        r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
        r")(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
upload_dir = Path(settings.UPLOAD_DIR)
if not upload_dir.is_absolute():
    upload_dir = Path(__file__).resolve().parents[1] / upload_dir
upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")
