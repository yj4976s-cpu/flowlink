CREATE TABLE IF NOT EXISTS admin_notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notification_type VARCHAR(60) NOT NULL CHECK (
        notification_type IN (
            'OPERATION_DETECTION_REVIEW_REQUIRED',
            'FOUND_ITEM_REGISTRATION_REQUIRED',
            'WASTE_COLLECTION_REQUIRED',
            'CITIZEN_REPORT_REVIEW_REQUIRED',
            'OWNERSHIP_CLAIM_REVIEW_REQUIRED',
            'OWNERSHIP_RETURN_REQUIRED'
        )
    ),
    title VARCHAR(150) NOT NULL CHECK (BTRIM(title) <> ''),
    message TEXT NOT NULL CHECK (BTRIM(message) <> ''),
    related_type VARCHAR(50) NOT NULL CHECK (BTRIM(related_type) <> ''),
    related_id BIGINT NOT NULL CHECK (related_id > 0),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_notifications_business_event
ON admin_notifications (notification_type, related_type, related_id);

CREATE INDEX IF NOT EXISTS ix_admin_notifications_created_at
ON admin_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_admin_notifications_resolved_at
ON admin_notifications (resolved_at);

CREATE TABLE IF NOT EXISTS admin_notification_reads (
    admin_notification_id BIGINT NOT NULL
        REFERENCES admin_notifications(id)
        ON DELETE CASCADE,
    admin_user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (admin_notification_id, admin_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_notification_reads_notification_admin
ON admin_notification_reads (admin_notification_id, admin_user_id);

CREATE INDEX IF NOT EXISTS ix_admin_notification_reads_admin_user
ON admin_notification_reads (admin_user_id, read_at DESC);

INSERT INTO admin_notifications (notification_type, title, message, related_type, related_id, created_at)
SELECT
    'OPERATION_DETECTION_REVIEW_REQUIRED',
    '새로운 운영 탐지 결과가 있습니다',
    '관리자 검토가 필요한 탐지 객체가 등록되었습니다.',
    'DETECTION_EVENT',
    event.id,
    COALESCE(event.processing_completed_at, event.updated_at, NOW())
FROM detection_events event
WHERE event.purpose = 'OPERATION'
  AND event.status = 'COMPLETED'
  AND EXISTS (
      SELECT 1
      FROM detected_objects obj
      WHERE obj.detection_event_id = event.id
        AND obj.processing_status = 'PENDING'
  )
ON CONFLICT (notification_type, related_type, related_id) DO NOTHING;

INSERT INTO admin_notifications (notification_type, title, message, related_type, related_id, created_at)
SELECT
    'FOUND_ITEM_REGISTRATION_REQUIRED',
    '공식 발견물 등록이 필요합니다',
    '검토가 완료된 개인 물품을 공식 발견물로 등록해 주세요.',
    'DETECTED_OBJECT',
    obj.id,
    COALESCE(obj.detected_at, NOW())
FROM detected_objects obj
JOIN detection_events event ON event.id = obj.detection_event_id
JOIN object_classes original_class ON original_class.id = obj.object_class_id
LEFT JOIN object_classes final_class ON final_class.code = obj.final_class_code
LEFT JOIN found_items found ON found.detected_object_id = obj.id
WHERE event.purpose = 'OPERATION'
  AND obj.processing_status = 'CONFIRMED'
  AND COALESCE(final_class.group_code, original_class.group_code) = 'PERSONAL_ITEM'
  AND found.id IS NULL
ON CONFLICT (notification_type, related_type, related_id) DO NOTHING;

INSERT INTO admin_notifications (notification_type, title, message, related_type, related_id, created_at)
SELECT
    'WASTE_COLLECTION_REQUIRED',
    '폐기물 수거 확인이 필요합니다',
    '확정된 폐기물의 현장 수거 상태를 확인해 주세요.',
    'DETECTED_OBJECT',
    obj.id,
    COALESCE(obj.detected_at, NOW())
FROM detected_objects obj
JOIN detection_events event ON event.id = obj.detection_event_id
JOIN object_classes original_class ON original_class.id = obj.object_class_id
LEFT JOIN object_classes final_class ON final_class.code = obj.final_class_code
WHERE event.purpose = 'OPERATION'
  AND obj.processing_status = 'CONFIRMED'
  AND COALESCE(final_class.group_code, original_class.group_code) = 'WASTE'
  AND NOT EXISTS (
      SELECT 1
      FROM processing_histories history
      WHERE history.entity_type = 'DETECTED_OBJECT'
        AND history.entity_id = obj.id
        AND history.action_type = 'WASTE_COLLECTION_COMPLETED'
  )
ON CONFLICT (notification_type, related_type, related_id) DO NOTHING;

INSERT INTO admin_notifications (notification_type, title, message, related_type, related_id, created_at)
SELECT
    'CITIZEN_REPORT_REVIEW_REQUIRED',
    '새로운 시민 발견 제보가 있습니다',
    '관리자 검토가 필요한 시민 제보가 등록되었습니다.',
    'CITIZEN_REPORT',
    report.id,
    report.created_at
FROM citizen_reports report
WHERE report.status IN ('PENDING', 'UNDER_REVIEW')
ON CONFLICT (notification_type, related_type, related_id) DO NOTHING;

INSERT INTO admin_notifications (notification_type, title, message, related_type, related_id, created_at)
SELECT
    'OWNERSHIP_CLAIM_REVIEW_REQUIRED',
    '새로운 소유권 확인 요청이 있습니다',
    '비공개 특징 확인이 필요한 소유권 요청이 등록되었습니다.',
    'OWNERSHIP_CLAIM',
    claim.id,
    claim.created_at
FROM ownership_claims claim
WHERE claim.status = 'PENDING'
ON CONFLICT (notification_type, related_type, related_id) DO NOTHING;

INSERT INTO admin_notifications (notification_type, title, message, related_type, related_id, created_at)
SELECT
    'OWNERSHIP_RETURN_REQUIRED',
    '승인된 물품의 반환 확인이 필요합니다',
    '소유권 승인이 완료된 물품의 실제 전달 상태를 확인해 주세요.',
    'OWNERSHIP_CLAIM',
    claim.id,
    COALESCE(claim.reviewed_at, claim.updated_at, NOW())
FROM ownership_claims claim
WHERE claim.status = 'APPROVED'
ON CONFLICT (notification_type, related_type, related_id) DO NOTHING;
