BEGIN;
CREATE TABLE IF NOT EXISTS copilot_conversations (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, public_id VARCHAR(36) NOT NULL UNIQUE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title VARCHAR(120) NOT NULL,
 context_type VARCHAR(30) NOT NULL DEFAULT 'GENERAL', context_entity_id BIGINT,
 summary TEXT, summary_updated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS copilot_messages (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, conversation_id BIGINT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
 role VARCHAR(12) NOT NULL CHECK (role IN ('USER','ASSISTANT')), content TEXT NOT NULL,
 presentation_type VARCHAR(30) NOT NULL DEFAULT 'TEXT', presentation JSONB, client_message_id VARCHAR(64), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (conversation_id, client_message_id)
);
CREATE TABLE IF NOT EXISTS copilot_message_refs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, message_id BIGINT NOT NULL REFERENCES copilot_messages(id) ON DELETE CASCADE,
 ref_type VARCHAR(30) NOT NULL, ref_id BIGINT NOT NULL, UNIQUE(message_id, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_copilot_conversations_user_recent ON copilot_conversations(user_id,last_message_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_copilot_messages_order ON copilot_messages(conversation_id,id);
CREATE INDEX IF NOT EXISTS idx_copilot_refs_entity ON copilot_message_refs(ref_type,ref_id);
COMMIT;
