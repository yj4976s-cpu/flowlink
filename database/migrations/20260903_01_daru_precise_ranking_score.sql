BEGIN;

ALTER TABLE public.daru_game_play_records
    ADD COLUMN ranking_score NUMERIC(7,4);

WITH difficulty_config(difficulty, pairs, benchmark_seconds, time_limit_seconds, combo_target) AS (
    VALUES
        ('EASY'::VARCHAR, 10::NUMERIC, 90::NUMERIC, 120::NUMERIC, 5::NUMERIC),
        ('NORMAL'::VARCHAR, 16::NUMERIC, 150::NUMERIC, 210::NUMERIC, 7::NUMERIC),
        ('HARD'::VARCHAR, 20::NUMERIC, 200::NUMERIC, 280::NUMERIC, 8::NUMERIC)
), score_components AS (
    SELECT
        record.id,
        GREATEST(0::NUMERIC, LEAST(100::NUMERIC, 100::NUMERIC - ((record.attempts - config.pairs) / config.pairs) * 50::NUMERIC)) AS memory_score,
        CASE
            WHEN NOT record.within_time_limit OR record.elapsed_seconds > config.time_limit_seconds THEN 0::NUMERIC
            WHEN record.elapsed_seconds <= config.benchmark_seconds / 2::NUMERIC THEN 100::NUMERIC
            WHEN record.elapsed_seconds <= config.benchmark_seconds THEN
                GREATEST(0::NUMERIC, LEAST(100::NUMERIC, 100::NUMERIC - 20::NUMERIC * ((record.elapsed_seconds - config.benchmark_seconds / 2::NUMERIC) / (config.benchmark_seconds / 2::NUMERIC))))
            ELSE
                GREATEST(40::NUMERIC, LEAST(100::NUMERIC, 80::NUMERIC - 40::NUMERIC * ((record.elapsed_seconds - config.benchmark_seconds) / (config.time_limit_seconds - config.benchmark_seconds))))
        END AS speed_score,
        LEAST(1::NUMERIC, record.max_combo / config.combo_target) * 100::NUMERIC AS combo_score,
        GREATEST(0::NUMERIC, LEAST(100::NUMERIC, 100::NUMERIC - record.hints_used * 50::NUMERIC)) AS hint_score
    FROM public.daru_game_play_records AS record
    JOIN difficulty_config AS config ON config.difficulty = record.difficulty
)
UPDATE public.daru_game_play_records AS record
SET ranking_score = ROUND(
    GREATEST(0::NUMERIC, LEAST(100::NUMERIC,
        components.memory_score * 0.50::NUMERIC
        + components.speed_score * 0.25::NUMERIC
        + components.combo_score * 0.15::NUMERIC
        + components.hint_score * 0.10::NUMERIC
    )),
    4
)
FROM score_components AS components
WHERE components.id = record.id;

ALTER TABLE public.daru_game_play_records
    ALTER COLUMN ranking_score SET NOT NULL,
    ADD CONSTRAINT ck_daru_game_play_records_ranking_score CHECK (ranking_score BETWEEN 0 AND 100);

CREATE INDEX ix_daru_game_play_records_ranking_score
    ON public.daru_game_play_records (ranking_score DESC, achieved_at ASC, id ASC);

COMMIT;
