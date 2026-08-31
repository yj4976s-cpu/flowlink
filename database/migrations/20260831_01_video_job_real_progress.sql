BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.video_jobs
        WHERE status IN ('PENDING', 'PROCESSING')
    ) THEN
        RAISE EXCEPTION 'video job progress migration aborted: resolve existing PENDING or PROCESSING video_jobs before retrying';
    END IF;
END $$;

ALTER TABLE public.video_jobs
    ADD COLUMN processing_stage VARCHAR(20),
    ADD COLUMN processed_frames INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN total_frames INTEGER,
    ADD COLUMN failed_stage VARCHAR(20);

UPDATE public.video_jobs
SET processing_stage = CASE
    WHEN status = 'COMPLETED' THEN 'COMPLETED'
    WHEN status = 'FAILED' THEN 'FAILED'
END;

ALTER TABLE public.video_jobs
    ALTER COLUMN processing_stage SET DEFAULT 'QUEUED',
    ALTER COLUMN processing_stage SET NOT NULL,
    ADD CONSTRAINT ck_video_jobs_processing_stage
        CHECK (processing_stage IN ('QUEUED', 'ANALYZING', 'RENDERING', 'SAVING', 'COMPLETED', 'FAILED')),
    ADD CONSTRAINT ck_video_jobs_processed_frames CHECK (processed_frames >= 0),
    ADD CONSTRAINT ck_video_jobs_total_frames CHECK (total_frames IS NULL OR total_frames > 0),
    ADD CONSTRAINT ck_video_jobs_failed_stage
        CHECK (failed_stage IS NULL OR failed_stage IN ('QUEUED', 'ANALYZING', 'RENDERING', 'SAVING'));

CREATE INDEX idx_video_jobs_queue
    ON public.video_jobs (created_at, id)
    WHERE status = 'PROCESSING' AND processing_stage = 'QUEUED';

COMMIT;
