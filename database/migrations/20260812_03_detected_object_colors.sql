ALTER TABLE detected_objects
    ADD COLUMN IF NOT EXISTS ai_color VARCHAR(50),
    ADD COLUMN IF NOT EXISTS confirmed_color VARCHAR(50);

COMMENT ON COLUMN detected_objects.ai_color IS
    'bbox 이미지에서 추정한 FlowLink 표준 색상명';

COMMENT ON COLUMN detected_objects.confirmed_color IS
    '관리자가 최종 확인한 FlowLink 표준 색상명';
