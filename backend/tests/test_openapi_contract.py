from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

EXPECTED_OPERATIONS = {
    "/health": {"get"},
    "/api/auth/register": {"post"},
    "/api/auth/login": {"post"},
    "/api/auth/logout": {"post"},
    "/api/auth/me": {"get", "delete"},
    "/api/copilot/chat": {"post"},
    "/api/community/posts": {"get", "post"},
    "/api/community/posts/{id}": {"get", "patch", "delete"},
    "/api/community/posts/{id}/comments": {"get", "post"},
    "/api/community/comments/{id}": {"delete"},
    "/api/detections/images": {"post"},
    "/api/detections/videos": {"post"},
    "/api/detections/me": {"get"},
    "/api/detections/me/summary": {"get"},
    "/api/detections/{id}": {"get"},
    "/api/lost-reports": {"post"},
    "/api/lost-reports/me": {"get"},
    "/api/lost-reports/{id}": {"get"},
    "/api/found-items": {"get"},
    "/api/found-items/map": {"get"},
    "/api/found-items/{id}": {"get"},
    "/api/matches/me": {"get"},
    "/api/ownership-claims": {"post"},
    "/api/notifications": {"get"},
    "/api/notifications/{id}/read": {"patch"},
    "/api/admin/detections/images": {"post"},
    "/api/admin/detections/videos": {"post"},
    "/api/admin/detections/mobile-waste": {"post"},
    "/api/admin/detections": {"get"},
    "/api/admin/detected-objects/{id}": {"patch"},
    "/api/admin/found-items/{id}": {"patch"},
    "/api/admin/dashboard": {"get"},
    "/api/admin/ownership-claims": {"get"},
    "/api/admin/ownership-claims/{id}": {"patch"},
}


def test_openapi_contains_expected_operations() -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    for path, methods in EXPECTED_OPERATIONS.items():
        assert path in paths
        assert methods <= paths[path].keys()
