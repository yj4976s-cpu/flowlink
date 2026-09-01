ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check CHECK (
    notification_type IN (
        'DETECTION_COMPLETED',
        'DETECTION_FAILED',
        'MATCH_FOUND',
        'STATUS_CHANGED',
        'CITIZEN_REPORT_STATUS'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_detection_terminal_once
ON notifications (user_id, notification_type, related_type, related_id)
WHERE related_type = 'DETECTION_EVENT'
  AND notification_type IN ('DETECTION_COMPLETED', 'DETECTION_FAILED');
