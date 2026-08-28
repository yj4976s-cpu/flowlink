BEGIN;

CREATE TABLE public.daru_game_play_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    difficulty VARCHAR(10) NOT NULL CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),
    detection_power NUMERIC(4,1) NOT NULL CHECK (detection_power BETWEEN 0 AND 100),
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds > 0),
    max_combo INTEGER NOT NULL CHECK (max_combo >= 0),
    hints_used SMALLINT NOT NULL CHECK (hints_used BETWEEN 0 AND 2),
    earned_daru_points BIGINT NOT NULL DEFAULT 0 CHECK (earned_daru_points >= 0),
    completed BOOLEAN NOT NULL,
    within_time_limit BOOLEAN NOT NULL,
    score_version INTEGER NOT NULL DEFAULT 2 CHECK (score_version IN (1, 2)),
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX ix_daru_game_play_records_user_difficulty_achieved
    ON public.daru_game_play_records (user_id, difficulty, achieved_at);
CREATE INDEX ix_daru_game_play_records_user_difficulty_deleted
    ON public.daru_game_play_records (user_id, difficulty, deleted_at);

ALTER TABLE public.daru_game_stats
    ADD COLUMN ranking_record_id BIGINT REFERENCES public.daru_game_play_records(id) ON DELETE SET NULL;
CREATE INDEX ix_daru_game_stats_ranking_record_id ON public.daru_game_stats (ranking_record_id);

INSERT INTO public.daru_game_play_records (
    user_id, difficulty, detection_power, attempts, elapsed_seconds, max_combo,
    hints_used, earned_daru_points, completed, within_time_limit, score_version,
    achieved_at, created_at
)
SELECT user_id, difficulty, best_detection_power, best_attempts,
       best_elapsed_seconds, best_combo, COALESCE(best_hints_used, 0), 0,
       TRUE, CASE difficulty WHEN 'EASY' THEN best_elapsed_seconds <= 120 WHEN 'NORMAL' THEN best_elapsed_seconds <= 210 ELSE best_elapsed_seconds <= 280 END,
       score_version, COALESCE(best_achieved_at, created_at),
       COALESCE(best_achieved_at, created_at)
FROM public.daru_game_stats
WHERE best_attempts IS NOT NULL;

UPDATE public.daru_game_stats AS stat
SET ranking_record_id = record.id
FROM public.daru_game_play_records AS record
WHERE record.user_id = stat.user_id
  AND record.difficulty = stat.difficulty
  AND record.achieved_at = COALESCE(stat.best_achieved_at, stat.created_at)
  AND stat.best_attempts IS NOT NULL;

ALTER TABLE public.daru_game_play_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daru_game_play_records FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.daru_game_play_records_id_seq FROM anon, authenticated;

COMMIT;
