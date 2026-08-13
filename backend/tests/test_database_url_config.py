import pytest

from app.core.config import Settings, normalize_database_url


@pytest.mark.parametrize("scheme", ["postgresql://", "postgres://"])
def test_postgres_url_uses_psycopg_driver(scheme: str) -> None:
    url = f"{scheme}db_user:db_password@db.example.com:5432/app"

    assert normalize_database_url(url) == (
        "postgresql+psycopg://db_user:db_password@db.example.com:5432/app"
    )


def test_explicit_psycopg_url_is_unchanged() -> None:
    url = "postgresql+psycopg://db_user:db_password@db.example.com:5432/app"

    assert normalize_database_url(url) == url


def test_non_postgres_development_url_is_unchanged() -> None:
    url = "sqlite+pysqlite:///:memory:"

    assert normalize_database_url(url) == url


def test_database_url_query_parameters_are_preserved() -> None:
    url = (
        "postgresql://db_user:db_password@db.example.com:5432/app"
        "?sslmode=require&application_name=flowlink"
    )

    assert normalize_database_url(url) == (
        "postgresql+psycopg://db_user:db_password@db.example.com:5432/app"
        "?sslmode=require&application_name=flowlink"
    )


def test_settings_apply_database_url_normalization() -> None:
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://db_user:db_password@db.example.com:5432/app",
    )

    assert settings.DATABASE_URL.startswith("postgresql+psycopg://")
