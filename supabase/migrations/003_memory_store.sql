-- ============================================================
-- Migration 003: Persistent memory store per user
-- ============================================================
-- Each provisioned agent gets a workspace-scoped memory store, mounted into
-- every session so the Chief of Staff retains context across conversations.

ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS anthropic_memory_store_id VARCHAR(255);
