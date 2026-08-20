BEGIN;

ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE user_social_accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    provider VARCHAR(20) NOT NULL
        CHECK (provider IN ('GOOGLE', 'NAVER', 'KAKAO')),

    provider_user_id VARCHAR(255) NOT NULL
        CHECK (BTRIM(provider_user_id) <> ''),

    provider_email VARCHAR(255),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_social_accounts_provider_identity
        UNIQUE (provider, provider_user_id),
    CONSTRAINT uq_user_social_accounts_user_provider
        UNIQUE (user_id, provider)
);

ALTER TABLE user_social_accounts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_user_social_accounts_updated_at
BEFORE UPDATE ON user_social_accounts
FOR EACH ROW
EXECUTE FUNCTION flowlink_set_updated_at();

COMMIT;
