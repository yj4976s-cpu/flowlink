BEGIN;

-- =========================================================
-- 경고: FlowLink의 모든 테이블과 저장된 데이터가 삭제됩니다.
-- 전체 초기화가 필요한 테스트 DB에서만 실행하세요.
-- 실행 후 schema.sql을 실행해 스키마를 다시 생성합니다.
-- =========================================================

DROP TABLE IF EXISTS
    processing_histories,
    notifications,
    ownership_claims,
    match_candidates,
    lost_reports,
    found_items,
    detected_objects,
    video_jobs,
    detection_events,
    object_classes,
    cameras,
    users,
    detected_items,
    detections,
    analyses
CASCADE;

DROP FUNCTION IF EXISTS flowlink_set_updated_at() CASCADE;

COMMIT;
