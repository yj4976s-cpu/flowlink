BEGIN;

ALTER TABLE public.daru_game_stats
    ADD COLUMN IF NOT EXISTS score_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.daru_game_stats
    ALTER COLUMN best_detection_power TYPE NUMERIC(4,1)
    USING best_detection_power::NUMERIC(4,1);

ALTER TABLE public.daru_game_stats
    ALTER COLUMN best_detection_power SET DEFAULT 0.0;

ALTER TABLE public.daru_game_stats
    ALTER COLUMN score_version SET DEFAULT 2;

ALTER TABLE public.daru_game_stats
    DROP CONSTRAINT IF EXISTS ck_daru_game_stats_score_version;

ALTER TABLE public.daru_game_stats
    ADD CONSTRAINT ck_daru_game_stats_score_version
    CHECK (score_version IN (1, 2));

DROP INDEX IF EXISTS public.idx_daru_game_stats_ranking;

CREATE INDEX idx_daru_game_stats_ranking
ON public.daru_game_stats (
    difficulty,
    score_version,
    best_detection_power DESC,
    best_attempts ASC,
    best_elapsed_seconds ASC,
    best_achieved_at ASC
);

COMMIT;
