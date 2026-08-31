from __future__ import annotations

import builtins
import json
import sys
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.admin as admin_api
from app.core.security import hash_password
from app.db.session import Base, get_db
from app.main import app
from app.models import AiModelDeploymentEvent, User
from app.services.ai_inference_client import AIInferenceRejectedError, AIInferenceUnavailableError
from app.services.model_comparison import ModelComparisonDataError, load_model_comparison


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    with factory() as session:
        yield session


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def seed_user(db: Session, *, user_id: int, role: str) -> None:
    now = datetime(2026, 8, 31, tzinfo=UTC)
    db.add(
        User(
            id=user_id,
            email=f"{role.lower()}@example.com",
            password_hash=hash_password("password123"),
            nickname=role.lower(),
            role=role,
            active=True,
            terms_agreed_at=now,
            privacy_agreed_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()


def login(client: TestClient, role: str) -> None:
    assert client.post("/api/auth/login", json={"email": f"{role.lower()}@example.com", "password": "password123"}).status_code == 200


def test_admin_model_comparison_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/admin/model-comparison")

    assert response.status_code == 401


def test_admin_model_comparison_requires_admin(client: TestClient, db: Session) -> None:
    seed_user(db, user_id=1, role="USER")
    login(client, "USER")

    response = client.get("/api/admin/model-comparison")

    assert response.status_code == 403


def test_admin_model_comparison_reads_versioned_json_without_loading_models(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    original_import = builtins.__import__

    def guard_import(name: str, *args, **kwargs):
        if name == "ultralytics" or name.startswith("ultralytics."):
            raise AssertionError("model comparison endpoint must not import or load YOLO")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guard_import)
    sys.modules.pop("ultralytics", None)

    response = client.get("/api/admin/model-comparison")

    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == 1
    assert body["current_deployed_model_id"] == "flowlink-4class-hat-v7"
    assert body["current_deployed_model_status"] == "신규 HAT 모델 배포 확인"
    assert [model["id"] for model in body["models"]] == ["flowlink-3class-v6-7", "flowlink-4class-hat-v7"]
    assert body["models"][0]["precision"] is None
    assert body["models"][1]["map50"] is None
    assert next(item for item in body["models"][0]["class_metrics"] if item["code"] == "HAT")["supported"] is False
    assert next(item for item in body["models"][1]["class_metrics"] if item["code"] == "HAT")["supported"] is True


def test_admin_model_comparison_hides_path_and_internal_errors(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    monkeypatch.setattr(admin_api, "load_model_comparison", lambda: (_ for _ in ()).throw(ModelComparisonDataError("C:/secret/model/path")))

    response = client.get("/api/admin/model-comparison")

    assert response.status_code == 503
    assert response.json()["detail"] == "Model comparison data is unavailable"
    assert "C:/secret" not in response.text


def test_model_comparison_loader_rejects_corrupt_json_safely(tmp_path) -> None:
    path = tmp_path / "model_comparison.json"
    path.write_text("{not json", encoding="utf-8")

    with pytest.raises(ModelComparisonDataError, match="unavailable"):
        load_model_comparison(path)


def test_model_comparison_loader_rejects_invalid_schema_safely(tmp_path) -> None:
    path = tmp_path / "model_comparison.json"
    path.write_text(json.dumps({"schema_version": 1, "models": []}), encoding="utf-8")

    with pytest.raises(ModelComparisonDataError, match="unavailable"):
        load_model_comparison(path)


def test_model_comparison_response_does_not_expose_secrets_or_absolute_paths(client: TestClient, db: Session) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")

    response = client.get("/api/admin/model-comparison")

    assert response.status_code == 200
    serialized = response.text.lower()
    assert ".pt" in serialized
    assert "c:\\" not in serialized
    assert "/users/" not in serialized
    assert "api_key" not in serialized
    assert "secret" not in serialized


class FakeDeploymentClient:
    def __init__(self, *, fail: Exception | None = None) -> None:
        self.fail = fail
        self.activations: list[dict[str, object]] = []
        self.rollbacks: list[dict[str, object]] = []

    def get_model_deployment_status(self) -> dict:
        if self.fail:
            raise self.fail
        return {
            "active_model_id": "flowlink-3class-v6-7",
            "previous_model_id": "flowlink-4class-hat-v7",
            "active_display_name": "기존 3클래스 모델",
            "active_classes": ["BALL", "FOOTWEAR", "TRASH"],
            "switched_at": "2026-08-31T00:00:00+00:00",
            "model_ready": True,
            "switching": False,
            "available_models": [
                {
                    "id": "flowlink-3class-v6-7",
                    "display_name": "기존 3클래스 모델",
                    "classes": ["BALL", "FOOTWEAR", "TRASH"],
                    "supports_hat": False,
                    "available": True,
                    "active": True,
                },
                {
                    "id": "flowlink-4class-hat-v7",
                    "display_name": "신규 HAT 4클래스 모델",
                    "classes": ["BALL", "HAT", "FOOTWEAR", "TRASH"],
                    "supports_hat": True,
                    "available": True,
                    "active": False,
                },
            ],
            "rollback_available": True,
        }

    def activate_model(self, *, model_id: str, expected_active_model_id: str | None, request_id: str) -> dict:
        if self.fail:
            raise self.fail
        self.activations.append(
            {
                "model_id": model_id,
                "expected_active_model_id": expected_active_model_id,
                "request_id": request_id,
            }
        )
        return {
            "changed": True,
            "previous_model_id": expected_active_model_id,
            "active_model_id": model_id,
            "active_classes": ["BALL", "HAT", "FOOTWEAR", "TRASH"],
            "switched_at": "2026-08-31T00:01:00+00:00",
            "model_ready": True,
        }

    def rollback_model(self, *, expected_active_model_id: str | None, request_id: str) -> dict:
        if self.fail:
            raise self.fail
        self.rollbacks.append({"expected_active_model_id": expected_active_model_id, "request_id": request_id})
        return {
            "changed": True,
            "previous_model_id": expected_active_model_id,
            "active_model_id": "flowlink-4class-hat-v7",
            "active_classes": ["BALL", "HAT", "FOOTWEAR", "TRASH"],
            "switched_at": "2026-08-31T00:02:00+00:00",
            "model_ready": True,
        }


def test_admin_model_deployment_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/admin/model-deployment")

    assert response.status_code == 401


def test_admin_model_deployment_requires_admin(client: TestClient, db: Session) -> None:
    seed_user(db, user_id=1, role="USER")
    login(client, "USER")

    response = client.get("/api/admin/model-deployment")

    assert response.status_code == 403


def test_admin_model_deployment_status_hides_internal_errors(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    monkeypatch.setattr(admin_api, "get_ai_inference_client", lambda: FakeDeploymentClient(fail=AIInferenceUnavailableError("C:/secret/model.pt")))

    response = client.get("/api/admin/model-deployment")

    assert response.status_code == 503
    assert response.json()["detail"] == "모델 서비스 상태를 확인할 수 없습니다."
    assert "secret" not in response.text.lower()


def test_admin_model_deployment_status_reports_no_audit_history(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    monkeypatch.setattr(admin_api, "get_ai_inference_client", lambda: FakeDeploymentClient())

    response = client.get("/api/admin/model-deployment")

    assert response.status_code == 200
    body = response.json()
    assert body["active_model_id"] == "flowlink-3class-v6-7"
    assert body["audit_consistency"] == "NO_HISTORY"
    assert body["audit_warning"] is None


def test_admin_model_deployment_status_reports_matched_audit(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    now = datetime(2026, 8, 31, tzinfo=UTC)
    db.add(
        AiModelDeploymentEvent(
            requested_by=1,
            request_id="matched-audit",
            action="ACTIVATE",
            requested_model_id="flowlink-3class-v6-7",
            from_model_id="flowlink-4class-hat-v7",
            to_model_id="flowlink-3class-v6-7",
            status="SUCCEEDED",
            requested_at=now,
            completed_at=now,
        )
    )
    db.commit()
    monkeypatch.setattr(admin_api, "get_ai_inference_client", lambda: FakeDeploymentClient())

    response = client.get("/api/admin/model-deployment")

    assert response.status_code == 200
    body = response.json()
    assert body["audit_consistency"] == "MATCHED"
    assert body["audit_warning"] is None


def test_admin_model_deployment_status_reports_safe_audit_mismatch(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    now = datetime(2026, 8, 31, tzinfo=UTC)
    db.add(
        AiModelDeploymentEvent(
            requested_by=1,
            request_id="mismatched-audit",
            action="ACTIVATE",
            requested_model_id="flowlink-4class-hat-v7",
            from_model_id="flowlink-3class-v6-7",
            to_model_id="flowlink-4class-hat-v7",
            status="SUCCEEDED",
            requested_at=now,
            completed_at=now,
        )
    )
    db.commit()
    monkeypatch.setattr(admin_api, "get_ai_inference_client", lambda: FakeDeploymentClient())

    response = client.get("/api/admin/model-deployment")

    assert response.status_code == 200
    body = response.json()
    assert body["active_model_id"] == "flowlink-3class-v6-7"
    assert body["audit_consistency"] == "MISMATCH"
    assert "Backend-AI runtime" in body["audit_warning"]
    assert "secret" not in response.text.lower()


def test_admin_model_activate_records_success_history(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    fake_client = FakeDeploymentClient()
    monkeypatch.setattr(admin_api, "get_ai_inference_client", lambda: fake_client)

    response = client.post(
        "/api/admin/model-deployment/activate",
        json={
            "model_id": "flowlink-4class-hat-v7",
            "expected_active_model_id": "flowlink-3class-v6-7",
            "request_id": "request-activate-1",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["active_model_id"] == "flowlink-4class-hat-v7"
    assert body["audit_event"]["status"] == "SUCCEEDED"
    event = db.query(AiModelDeploymentEvent).one()
    assert event.requested_by == 1
    assert event.request_id == "request-activate-1"
    assert event.status == "SUCCEEDED"
    assert fake_client.activations[0]["model_id"] == "flowlink-4class-hat-v7"


def test_admin_model_activate_records_safe_failure(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    monkeypatch.setattr(admin_api, "get_ai_inference_client", lambda: FakeDeploymentClient(fail=AIInferenceRejectedError("C:/secret/model.pt", status_code=422)))

    response = client.post(
        "/api/admin/model-deployment/activate",
        json={
            "model_id": "flowlink-4class-hat-v7",
            "expected_active_model_id": "flowlink-3class-v6-7",
            "request_id": "request-activate-2",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "후보 모델 검증에 실패했습니다."
    assert "secret" not in response.text.lower()
    event = db.query(AiModelDeploymentEvent).one()
    assert event.status == "FAILED"
    assert event.failure_code == "MODEL_VALIDATION_FAILED"


def test_admin_model_rollback_records_history(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    fake_client = FakeDeploymentClient()
    monkeypatch.setattr(admin_api, "get_ai_inference_client", lambda: fake_client)

    response = client.post(
        "/api/admin/model-deployment/rollback",
        json={"expected_active_model_id": "flowlink-3class-v6-7", "request_id": "request-rollback-1"},
    )

    assert response.status_code == 200
    assert response.json()["audit_event"]["action"] == "ROLLBACK"
    assert db.query(AiModelDeploymentEvent).one().status == "SUCCEEDED"


def test_admin_model_deployment_history_returns_recent_events(client: TestClient, db: Session) -> None:
    seed_user(db, user_id=1, role="ADMIN")
    login(client, "ADMIN")
    now = datetime(2026, 8, 31, tzinfo=UTC)
    db.add(
        AiModelDeploymentEvent(
            requested_by=1,
            request_id="history-1",
            action="ACTIVATE",
            requested_model_id="flowlink-4class-hat-v7",
            from_model_id="flowlink-3class-v6-7",
            to_model_id="flowlink-4class-hat-v7",
            status="SUCCEEDED",
            requested_at=now,
            completed_at=now,
        )
    )
    db.commit()

    response = client.get("/api/admin/model-deployment/history")

    assert response.status_code == 200
    body = response.json()
    assert body["events"][0]["requester_email"] == "admin@example.com"
    assert body["events"][0]["status"] == "SUCCEEDED"
