BEGIN;

ALTER TABLE found_items ADD COLUMN source_type VARCHAR(10);
ALTER TABLE found_items ADD CONSTRAINT ck_found_items_source_type
    CHECK (source_type IN ('AI', 'CITIZEN', 'ADMIN'));

-- The production table was verified empty before this migration. Keep an
-- explicit guard so a later run never assigns a meaningless default.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM found_items WHERE source_type IS NULL) THEN
        RAISE EXCEPTION 'found_items contains rows without an explicit source_type';
    END IF;
END $$;

ALTER TABLE found_items ALTER COLUMN source_type SET NOT NULL;

CREATE TABLE citizen_reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    object_class_id BIGINT NOT NULL REFERENCES object_classes(id),
    color VARCHAR(50), description TEXT NOT NULL CHECK (BTRIM(description) <> ''),
    image_url TEXT, area_name VARCHAR(100) NOT NULL CHECK (BTRIM(area_name) <> ''),
    latitude NUMERIC(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude NUMERIC(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    found_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'LINKED', 'REJECTED', 'CANCELLED')),
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ, rejection_reason TEXT, admin_memo TEXT,
    linked_found_item_id BIGINT REFERENCES found_items(id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status <> 'LINKED' OR (linked_found_item_id IS NOT NULL AND linked_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
    CHECK (status <> 'REJECTED' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND BTRIM(COALESCE(rejection_reason, '')) <> ''))
);

CREATE TABLE citizen_sightings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    citizen_report_id BIGINT NOT NULL REFERENCES citizen_reports(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    sighted_at TIMESTAMPTZ NOT NULL,
    location_name VARCHAR(100) NOT NULL CHECK (BTRIM(location_name) <> ''),
    latitude NUMERIC(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude NUMERIC(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    description TEXT NOT NULL CHECK (BTRIM(description) <> ''), image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE processing_histories DROP CONSTRAINT processing_histories_entity_type_check;
ALTER TABLE processing_histories ADD CONSTRAINT processing_histories_entity_type_check CHECK (
    entity_type IN ('DETECTION_EVENT','DETECTED_OBJECT','FOUND_ITEM','LOST_REPORT','MATCH_CANDIDATE','OWNERSHIP_CLAIM','VIDEO_JOB','CITIZEN_REPORT','CITIZEN_SIGHTING')
);
ALTER TABLE notifications DROP CONSTRAINT notifications_notification_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check CHECK (
    notification_type IN ('DETECTION_COMPLETED','MATCH_FOUND','STATUS_CHANGED','CITIZEN_REPORT_STATUS')
);

CREATE TRIGGER trg_citizen_reports_updated_at BEFORE UPDATE ON citizen_reports
FOR EACH ROW EXECUTE FUNCTION flowlink_set_updated_at();
CREATE INDEX idx_found_items_source_created ON found_items (source_type, created_at DESC);
CREATE INDEX idx_citizen_reports_user_created ON citizen_reports (user_id, created_at DESC);
CREATE INDEX idx_citizen_reports_status_found ON citizen_reports (status, found_at DESC, id DESC);
CREATE INDEX idx_citizen_reports_class_found ON citizen_reports (object_class_id, found_at DESC);
CREATE INDEX idx_citizen_reports_linked_item ON citizen_reports (linked_found_item_id);
CREATE INDEX idx_citizen_sightings_report_date ON citizen_sightings (citizen_report_id, sighted_at DESC, id DESC);
CREATE INDEX idx_citizen_sightings_user_created ON citizen_sightings (user_id, created_at DESC);

COMMIT;
