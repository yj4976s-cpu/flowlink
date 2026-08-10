BEGIN;

ALTER TABLE detection_events
    ADD COLUMN IF NOT EXISTS user_id BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'OPERATION',
    ADD COLUMN IF NOT EXISTS media_width INTEGER,
    ADD COLUMN IF NOT EXISTS media_height INTEGER;

ALTER TABLE detection_events
    DROP CONSTRAINT IF EXISTS chk_detection_events_purpose,
    ADD CONSTRAINT chk_detection_events_purpose
        CHECK (purpose IN ('USER_ANALYSIS', 'OPERATION'));

ALTER TABLE detection_events
    DROP CONSTRAINT IF EXISTS chk_detection_events_media_width,
    ADD CONSTRAINT chk_detection_events_media_width
        CHECK (media_width IS NULL OR media_width > 0);

ALTER TABLE detection_events
    DROP CONSTRAINT IF EXISTS chk_detection_events_media_height,
    ADD CONSTRAINT chk_detection_events_media_height
        CHECK (media_height IS NULL OR media_height > 0);

CREATE INDEX IF NOT EXISTS idx_detection_events_user_purpose_created
    ON detection_events (
        user_id,
        purpose,
        created_at DESC
    );

COMMIT;
