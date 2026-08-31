from pathlib import Path


ROOT = Path(__file__).parents[2]
SCHEMA = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
RLS_MIGRATION = (
    ROOT
    / "database"
    / "migrations"
    / "20260831_03_enable_ai_model_deployment_events_rls.sql"
).read_text(encoding="utf-8")

RLS_STATEMENT = """ALTER TABLE public.ai_model_deployment_events
ENABLE ROW LEVEL SECURITY;"""


def test_bootstrap_schema_contains_canonical_hat_seed() -> None:
    assert "('HAT', '모자', 'PERSONAL_ITEM', 14)" in SCHEMA


def test_bootstrap_and_reconciliation_migration_enable_deployment_event_rls() -> None:
    assert RLS_STATEMENT in SCHEMA
    assert RLS_STATEMENT in RLS_MIGRATION
    assert RLS_MIGRATION.strip().startswith("BEGIN;")
    assert RLS_MIGRATION.strip().endswith("COMMIT;")


def test_rls_reconciliation_is_enable_only() -> None:
    upper_migration = RLS_MIGRATION.upper()

    for forbidden in ("DROP", "TRUNCATE", "DELETE", "UPDATE", "DISABLE"):
        assert forbidden not in upper_migration
