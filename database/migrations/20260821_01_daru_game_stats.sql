BEGIN;

CREATE TABLE IF NOT EXISTS public.daru_game_stats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    difficulty VARCHAR(10) NOT NULL CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),
    best_detection_power SMALLINT NOT NULL DEFAULT 0 CHECK (best_detection_power BETWEEN 0 AND 100),
    best_attempts INTEGER CHECK (best_attempts IS NULL OR best_attempts > 0),
    best_elapsed_seconds INTEGER CHECK (best_elapsed_seconds IS NULL OR best_elapsed_seconds > 0),
    best_combo INTEGER NOT NULL DEFAULT 0 CHECK (best_combo >= 0),
    best_hints_used SMALLINT CHECK (best_hints_used IS NULL OR best_hints_used BETWEEN 0 AND 2),
    total_daru_points BIGINT NOT NULL DEFAULT 0 CHECK (total_daru_points >= 0),
    play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0),
    best_achieved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, difficulty)
);

ALTER TABLE public.daru_game_stats ADD COLUMN IF NOT EXISTS best_hints_used SMALLINT;
ALTER TABLE public.daru_game_stats DROP CONSTRAINT IF EXISTS ck_daru_game_stats_hints;
ALTER TABLE public.daru_game_stats ADD CONSTRAINT ck_daru_game_stats_hints CHECK (best_hints_used IS NULL OR best_hints_used BETWEEN 0 AND 2);

DROP INDEX IF EXISTS public.idx_daru_game_stats_ranking;
CREATE INDEX idx_daru_game_stats_ranking
ON public.daru_game_stats (difficulty, best_detection_power DESC, best_hints_used ASC, best_attempts ASC, best_elapsed_seconds ASC, best_achieved_at ASC);

ALTER TABLE public.daru_game_stats ENABLE ROW LEVEL SECURITY;

COMMIT;
