from fastapi import APIRouter

from app.api import admin, auth, citizen_reports, community, copilot, daru_game, detections, found_items, lost_reports, matches, notifications, oauth, ownership_claims, system

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(auth.router)
api_router.include_router(oauth.router)
api_router.include_router(copilot.router)
api_router.include_router(community.router)
api_router.include_router(daru_game.router)
api_router.include_router(detections.router)
api_router.include_router(citizen_reports.router)
api_router.include_router(lost_reports.router)
api_router.include_router(found_items.router)
api_router.include_router(matches.router)
api_router.include_router(ownership_claims.router)
api_router.include_router(notifications.router)
api_router.include_router(admin.router)
