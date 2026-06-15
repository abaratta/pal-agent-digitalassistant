-- ============================================================
-- Migration 001: Initial schema
-- ============================================================

-- Tracks global state and identity for each registered user
CREATE TABLE user_sessions (
    telegram_chat_id        BIGINT PRIMARY KEY,
    onboarding_completed    BOOLEAN DEFAULT FALSE,
    current_step            VARCHAR(50) DEFAULT 'collect_name',

    -- Client profile
    user_name               VARCHAR(255),
    email                   VARCHAR(255),
    company                 VARCHAR(255),
    website                 VARCHAR(255),

    -- Anthropic integration (key stored AES-GCM-256 encrypted)
    encrypted_anthropic_key TEXT,
    anthropic_agent_id      VARCHAR(255),
    anthropic_environment_id VARCHAR(255),

    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_onboarding ON user_sessions(telegram_chat_id, onboarding_completed);

-- Maps Telegram chat threads to Anthropic agent session IDs
CREATE TABLE agent_conversations (
    id                      BIGSERIAL PRIMARY KEY,
    telegram_chat_id        BIGINT NOT NULL REFERENCES user_sessions(telegram_chat_id) ON DELETE CASCADE,
    anthropic_session_id    VARCHAR(255) NOT NULL,
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tg_chat_active ON agent_conversations(telegram_chat_id, is_active);

-- Idempotency cache: processed Telegram update_ids expire after 5 minutes
CREATE TABLE processed_updates (
    update_id   BIGINT PRIMARY KEY,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-purge rows older than 5 minutes (requires pg_cron extension in Supabase)
-- Schedule: select cron.schedule('purge-updates', '*/5 * * * *', $$DELETE FROM processed_updates WHERE created_at < NOW() - INTERVAL '5 minutes'$$);

-- Auto-update updated_at on user_sessions
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_sessions_updated_at
BEFORE UPDATE ON user_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_agent_conversations_updated_at
BEFORE UPDATE ON agent_conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
