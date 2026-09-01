ALTER TABLE video_jobs
    DROP CONSTRAINT IF EXISTS ck_video_jobs_processing_stage,
    ADD CONSTRAINT ck_video_jobs_processing_stage
        CHECK (
            processing_stage IN (
                'QUEUED',
                'NORMALIZING',
                'ANALYZING',
                'RENDERING',
                'SAVING',
                'COMPLETED',
                'FAILED'
            )
        );

ALTER TABLE video_jobs
    DROP CONSTRAINT IF EXISTS ck_video_jobs_failed_stage,
    ADD CONSTRAINT ck_video_jobs_failed_stage
        CHECK (
            failed_stage IS NULL
            OR failed_stage IN (
                'QUEUED',
                'NORMALIZING',
                'ANALYZING',
                'RENDERING',
                'SAVING'
            )
        );
