BEGIN;

ALTER TABLE public.daru_game_runs
    ADD COLUMN IF NOT EXISTS play_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deck_state JSONB NOT NULL DEFAULT '[]'::JSONB,
    ADD COLUMN IF NOT EXISTS first_position INTEGER,
    ADD COLUMN IF NOT EXISTS matched_positions JSONB NOT NULL DEFAULT '[]'::JSONB,
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS matched_pairs INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_combo INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_combo INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS hints_used INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS earned_daru_points BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.daru_game_runs
    DROP CONSTRAINT IF EXISTS ck_daru_game_runs_authoritative_state;

ALTER TABLE public.daru_game_runs
    ADD CONSTRAINT ck_daru_game_runs_authoritative_state CHECK (
        attempts >= 0
        AND matched_pairs >= 0
        AND current_combo >= 0
        AND max_combo >= current_combo
        AND hints_used BETWEEN 0 AND 2
        AND earned_daru_points >= 0
        AND (first_position IS NULL OR first_position >= 0)
    );

COMMIT;
