ALTER TABLE community_comments
    ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT REFERENCES community_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_community_comments_parent
    ON community_comments (parent_comment_id, created_at)
    WHERE deleted_at IS NULL;
