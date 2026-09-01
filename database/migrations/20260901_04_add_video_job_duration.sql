ALTER TABLE video_jobs
ADD COLUMN IF NOT EXISTS video_duration_seconds NUMERIC(6, 2);

ALTER TABLE video_jobs
DROP CONSTRAINT IF EXISTS video_jobs_video_duration_seconds_check;

ALTER TABLE video_jobs
ADD CONSTRAINT video_jobs_video_duration_seconds_check
CHECK (
    video_duration_seconds IS NULL
    OR (
        video_duration_seconds > 0
        AND video_duration_seconds <= 30
    )
);
