ALTER TABLE detection_events
    ADD COLUMN IF NOT EXISTS ai_model_id VARCHAR(100);

CREATE TABLE IF NOT EXISTS ai_model_deployment_events (
    id BIGSERIAL PRIMARY KEY,
    requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    request_id VARCHAR(120) NOT NULL,
    action VARCHAR(20) NOT NULL,
    requested_model_id VARCHAR(100),
    from_model_id VARCHAR(100),
    to_model_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    failure_code VARCHAR(80),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT ck_ai_model_deployment_events_action CHECK (action IN ('ACTIVATE', 'ROLLBACK')),
    CONSTRAINT ck_ai_model_deployment_events_status CHECK (status IN ('REQUESTED', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT uq_ai_model_deployment_events_request_id UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS ix_ai_model_deployment_events_requested_at
    ON ai_model_deployment_events (requested_at DESC);
