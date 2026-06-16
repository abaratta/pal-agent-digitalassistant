-- ============================================================
-- Migration 002: Managed-agent + vault + MCP columns
-- ============================================================
-- The original schema referenced anthropic_agent_id / anthropic_environment_id
-- but nothing created those resources. We now provision an Agent + Environment
-- during onboarding, an (initially empty) Vault for MCP credentials, persist the
-- knowledge-base file IDs, and record which MCP connectors the user selected.

ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS anthropic_vault_id   VARCHAR(255),
    ADD COLUMN IF NOT EXISTS anthropic_file_ids   TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS mcp_connectors       TEXT[] DEFAULT '{}';
