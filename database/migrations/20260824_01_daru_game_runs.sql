BEGIN;

CREATE TABLE IF NOT EXISTS public.daru_game_runs (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    difficulty VARCHAR(10) NOT NULL CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ,
    CHECK (consumed_at IS NULL OR consumed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_daru_game_runs_active_user
ON public.daru_game_runs (user_id, started_at DESC)
WHERE consumed_at IS NULL;

ALTER TABLE public.daru_game_runs ENABLE ROW LEVEL SECURITY;

COMMIT;
