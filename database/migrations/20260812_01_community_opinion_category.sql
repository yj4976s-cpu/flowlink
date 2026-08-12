ALTER TABLE community_posts
    DROP CONSTRAINT IF EXISTS community_posts_category_check;

ALTER TABLE community_posts
    ADD CONSTRAINT community_posts_category_check
    CHECK (category IN ('FIELD_STORY', 'QUESTION', 'EXPERIENCE', 'OPINION'));
