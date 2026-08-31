from fastapi import APIRouter

from app.api.inference import router as inference_router
from app.api.runtime import router as runtime_router

api_router = APIRouter()
api_router.include_router(inference_router)
api_router.include_router(runtime_router)
