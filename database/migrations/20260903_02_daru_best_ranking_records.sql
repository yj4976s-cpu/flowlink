BEGIN;

WITH ranked_records AS (
    SELECT
        record.id,
        record.user_id,
        record.difficulty,
        record.detection_power,
        record.score_version,
        record.attempts,
        record.elapsed_seconds,
        record.max_combo,
        record.hints_used,
        record.achieved_at,
        ROW_NUMBER() OVER (
            PARTITION BY record.user_id, record.difficulty
            ORDER BY
                record.ranking_score DESC,
                record.achieved_at ASC,
                record.id ASC
        ) AS position
    FROM public.daru_game_play_records AS record
    WHERE record.completed = TRUE
      AND record.deleted_at IS NULL
      AND record.score_version = 2
), best_records AS (
    SELECT * FROM ranked_records WHERE position = 1
)
UPDATE public.daru_game_stats AS stat
SET
    score_version = COALESCE(best.score_version, 2),
    best_detection_power = COALESCE(best.detection_power, 0.0),
    best_attempts = best.attempts,
    best_elapsed_seconds = best.elapsed_seconds,
    best_combo = COALESCE(best.max_combo, 0),
    best_hints_used = best.hints_used,
    best_achieved_at = best.achieved_at,
    ranking_record_id = best.id,
    updated_at = NOW()
FROM public.daru_game_stats AS current_stat
LEFT JOIN best_records AS best
  ON best.user_id = current_stat.user_id
 AND best.difficulty = current_stat.difficulty
WHERE stat.id = current_stat.id;

COMMIT;
