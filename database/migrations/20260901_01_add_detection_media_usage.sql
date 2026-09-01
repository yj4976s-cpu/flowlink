ALTER TABLE detection_events
    ADD COLUMN IF NOT EXISTS original_media_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS result_media_bytes BIGINT;

ALTER TABLE detection_events
    DROP CONSTRAINT IF EXISTS chk_detection_events_original_media_bytes,
    ADD CONSTRAINT chk_detection_events_original_media_bytes
        CHECK (
            original_media_bytes IS NULL
            OR original_media_bytes >= 0
        );

ALTER TABLE detection_events
    DROP CONSTRAINT IF EXISTS chk_detection_events_result_media_bytes,
    ADD CONSTRAINT chk_detection_events_result_media_bytes
        CHECK (
            result_media_bytes IS NULL
            OR result_media_bytes >= 0
        );

CREATE INDEX IF NOT EXISTS idx_detection_events_user_media_usage
    ON detection_events (
        user_id,
        purpose,
        status,
        source_type,
        created_at DESC
    );
