# PAL Agent — Unified Telegram Gateway for Anthropic Managed Agents

A single, multi-tenant Telegram bot that acts as an intelligent front-end for custom cloud-hosted AI agents ("Digital Chief of Staff"). Instead of one bot per client, this unified gateway routes each incoming message to the correct client agent instance using **deep linking** and per-user state filtering.

## What it does

The bot runs in one of two modes **per user**:

1. **Onboarding (Linear Wizard)** — Collects profile details, captures and encrypts the client's Anthropic API key, forwards uploaded knowledge documents to Anthropic's Files API, and walks the user through MCP server setup.
2. **Operational (Agent Proxy Router)** — Forwards natural-language prompts to the client's Anthropic Managed Agent, preserving conversation continuity across chat threads with live, throttled message streaming.

## Architecture

```
[Telegram] ──▶ [Vercel Gateway] ──(instant 200 OK)──▶ [Trigger.dev Worker] ──▶ [Anthropic Managed Agent]
                                                              │
                                                       [Supabase / Postgres]
```

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Serverless Gateway | Vercel | Receive Telegram webhooks, hand off in <200ms |
| Asynchronous Core | Trigger.dev v3 | Route events, run onboarding wizard, proxy chats |
| State / Vault DB | Supabase (PostgreSQL) | Tenant profiles, encrypted keys, session mapping |
| Agent Runtime | Anthropic Managed Agents | All model inference, file storage, MCP tooling |

The gateway is **proxy-only**: no tokenizers, chunking, vector indices, or model instances run locally. All indexing, analysis, and storage are offloaded to Anthropic's managed infrastructure.

## Database

Two Postgres tables (see [PDR.md](PDR.md) §2 for full DDL):

- **`user_sessions`** — per-user global state, onboarding step, profile metadata, encrypted Anthropic integration layer.
- **`agent_conversations`** — mapping between Telegram chats and active Anthropic agent sessions.

## Security

- **AES-GCM-256 at rest** — API keys are encrypted before storage; decrypted only in volatile memory for outbound calls. Never logged or stored as plaintext.
- **Idempotency** — Telegram `update_id`s are cached for 5 minutes to drop duplicate webhook retries.
- **Strict boundaries** — gateway never persists document content; Anthropic owns the data plane.

## Project status

🚧 Early scaffolding. Specification is complete in [PDR.md](PDR.md); implementation has not started.

## Getting started

> Implementation pending. Planned setup once code lands:

```bash
# Install dependencies
npm install

# Environment variables (.env)
#   TELEGRAM_BOT_TOKEN=
#   SUPABASE_URL=
#   SUPABASE_SERVICE_ROLE_KEY=
#   TRIGGER_SECRET_KEY=
#   ENCRYPTION_KEY=            # 32-byte key for AES-GCM-256

# Apply the SQL schema from PDR.md §2 to your Supabase project
# Deploy the Vercel webhook + Trigger.dev tasks
```

## Documentation

- **[PDR.md](PDR.md)** — full Product Development Requirements: schema, architecture, onboarding state machine, proxy router spec, and security constraints.
