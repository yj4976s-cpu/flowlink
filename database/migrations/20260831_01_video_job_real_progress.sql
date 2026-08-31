BEGIN;

ALTER TABLE public.video_jobs
    ADD COLUMN processing_stage VARCHAR(20),
    ADD COLUMN processed_frames INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN total_frames INTEGER;

UPDATE public.video_jobs
SET processing_stage = CASE
    WHEN status = 'COMPLETED' THEN 'COMPLETED'
    WHEN status = 'FAILED' THEN 'FAILED'
    ELSE 'QUEUED'
END;

ALTER TABLE public.video_jobs
    ALTER COLUMN processing_stage SET DEFAULT 'QUEUED',
    ALTER COLUMN processing_stage SET NOT NULL,
    ADD CONSTRAINT ck_video_jobs_processing_stage
        CHECK (processing_stage IN ('QUEUED', 'ANALYZING', 'RENDERING', 'SAVING', 'COMPLETED', 'FAILED')),
    ADD CONSTRAINT ck_video_jobs_processed_frames CHECK (processed_frames >= 0),
    ADD CONSTRAINT ck_video_jobs_total_frames CHECK (total_frames IS NULL OR total_frames > 0);

CREATE INDEX idx_video_jobs_queue
    ON public.video_jobs (created_at, id)
    WHERE status = 'PROCESSING' AND processing_stage = 'QUEUED';

COMMIT;
