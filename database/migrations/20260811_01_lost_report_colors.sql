BEGIN;

ALTER TABLE lost_reports ADD COLUMN IF NOT EXISTS colors JSONB;

UPDATE lost_reports
SET colors = CASE
    WHEN color IS NULL OR BTRIM(color) = '' THEN '[]'::JSONB
    ELSE jsonb_build_array(color)
END
WHERE colors IS NULL;

ALTER TABLE lost_reports
    ALTER COLUMN colors SET DEFAULT '[]'::JSONB,
    ALTER COLUMN colors SET NOT NULL;

ALTER TABLE lost_reports DROP CONSTRAINT IF EXISTS ck_lost_reports_colors;
ALTER TABLE lost_reports ADD CONSTRAINT ck_lost_reports_colors
    CHECK (jsonb_typeof(colors) = 'array' AND jsonb_array_length(colors) <= 3);

COMMIT;
