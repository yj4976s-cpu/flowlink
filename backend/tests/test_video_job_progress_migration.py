from pathlib import Path


MIGRATION = (
    Path(__file__).parents[2] / "database" / "migrations" / "20260831_01_video_job_real_progress.sql"
).read_text(encoding="utf-8")


def test_video_job_progress_migration_fails_before_schema_changes_for_legacy_active_jobs() -> None:
    guard_position = MIGRATION.index("DO $$")
    alter_position = MIGRATION.index("ALTER TABLE public.video_jobs")

    assert MIGRATION.strip().startswith("BEGIN;")
    assert guard_position < alter_position
    assert "status IN ('PENDING', 'PROCESSING')" in MIGRATION
    assert "RAISE EXCEPTION 'video job progress migration aborted" in MIGRATION
    assert MIGRATION.strip().endswith("COMMIT;")


def test_video_job_progress_migration_backfills_only_terminal_rows() -> None:
    assert "WHEN status = 'COMPLETED' THEN 'COMPLETED'" in MIGRATION
    assert "WHEN status = 'FAILED' THEN 'FAILED'" in MIGRATION
    assert "WHERE status IN ('COMPLETED', 'FAILED');" in MIGRATION
    assert "ELSE 'QUEUED'" not in MIGRATION
    assert "ALTER COLUMN processing_stage SET DEFAULT 'QUEUED'" in MIGRATION


def test_video_job_progress_migration_preserves_new_failure_context() -> None:
    assert "ADD COLUMN failed_stage VARCHAR(20)" in MIGRATION
    assert "failed_stage IS NULL OR failed_stage IN ('QUEUED', 'ANALYZING', 'RENDERING', 'SAVING')" in MIGRATION
