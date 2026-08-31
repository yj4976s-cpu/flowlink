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
from app.models import User
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
    assert body["current_deployed_model_id"] is None
    assert body["current_deployed_model_status"] == "확인 필요"
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
