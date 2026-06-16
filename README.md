# PAL Agent — Unified Telegram Gateway for Anthropic Managed Agents

A single, multi-tenant Telegram bot that acts as an intelligent front-end for custom cloud-hosted AI agents ("Digital Personal Assistant"). Instead of one bot per client, this unified gateway routes each incoming message to the correct client agent instance using per-user state in the database. Each user brings their own Anthropic API key; the bot provisions a dedicated Managed Agent, environment, vault, and memory store for them, then proxies chat between Telegram and that agent.

> **Status (2026-06-16):** Working end-to-end in local dev. Onboarding wizard provisions real Anthropic resources, uploads knowledge files, declares MCP connectors, and the operational proxy streams agent replies back to Telegram. Deployed to Vercel for the webhook; the Trigger.dev worker currently runs locally (`npm run dev`). See [Current status & roadmap](#current-status--roadmap) for what's done and what's left.

## What it does

The bot runs in one of two modes **per user**, branched on the `onboarding_completed` flag:

1. **Onboarding (Linear Wizard)** — Collects name, email, company, website; captures and AES-GCM-256-encrypts the client's Anthropic API key; provisions a Managed Agent + environment + vault + memory store; forwards uploaded knowledge documents to Anthropic's Files API; and lets the user pick MCP connectors via an inline keyboard.
2. **Operational (Agent Proxy Router)** — Forwards natural-language prompts to the user's Anthropic Managed Agent, preserving conversation continuity across chat threads, with live throttled message-edit streaming back into Telegram.

## Architecture

```
[Telegram] ──▶ [Vercel Gateway] ──(instant 200 OK)──▶ [Trigger.dev Worker] ──▶ [Anthropic Managed Agents]
  api/webhook.ts                       trigger/*.ts                  │
                                                              [Supabase / Postgres]
                                                              lib/supabase.ts
```

| Layer | Technology | Responsibility | Code |
| --- | --- | --- | --- |
| Serverless Gateway | Vercel | Receive Telegram webhooks, trigger async task, return <200ms | [`api/webhook.ts`](api/webhook.ts) |
| Asynchronous Core | Trigger.dev v4 | Idempotency, load state, route to onboarding or proxy | [`trigger/`](trigger/) |
| State / Vault DB | Supabase (PostgreSQL) | Tenant profiles, encrypted keys, session mapping, idempotency | [`supabase/migrations/`](supabase/migrations/) |
| Agent Runtime | Anthropic Managed Agents | All model inference, file storage, memory, MCP tooling | [`lib/anthropic.ts`](lib/anthropic.ts) |

The gateway is **proxy-only**: no tokenizers, chunking, vector indices, or model instances run locally. All indexing, analysis, and storage are offloaded to Anthropic's managed infrastructure.

## File map

| Path | Purpose |
| --- | --- |
| [`api/webhook.ts`](api/webhook.ts) | Vercel handler. Parses Telegram update (message **or** `callback_query`), fires the `route-telegram-event` task, returns 200 instantly. |
| [`trigger/router.ts`](trigger/router.ts) | Task entry point. Loads `.env`, forces IPv4, dedupes by `update_id`, loads/creates the user session, branches to onboarding vs. proxy. |
| [`trigger/onboarding.ts`](trigger/onboarding.ts) | The onboarding state machine (one `case` per `current_step`) + the MCP connector inline-keyboard flow. |
| [`trigger/agent.ts`](trigger/agent.ts) | Operational proxy: resolves/creates an Anthropic session, streams the reply, handles `/newchat`. |
| [`lib/anthropic.ts`](lib/anthropic.ts) | All Managed Agents SDK calls: `provisionAgent`, `setAgentConnectors`, `uploadKnowledgeFile`, `createSession`, `runPrompt`. The connector registry (`CONNECTORS`) lives here. |
| [`lib/supabase.ts`](lib/supabase.ts) | Supabase client + `UserSession` / `AgentConversation` row types. |
| [`lib/telegram.ts`](lib/telegram.ts) | Bot API helpers: `sendMessage`, `editMessage`, `getFileUrl`, `sendKeyboard`, `answerCallback`, `escapeMd` (MarkdownV2). |
| [`lib/crypto.ts`](lib/crypto.ts) | AES-GCM-256 encrypt/decrypt for the per-user Anthropic key. |
| [`lib/netfix.ts`](lib/netfix.ts) | Forces IPv4 outbound via an undici global dispatcher (dev-network IPv6 to Telegram was broken). |
| [`supabase/migrations/`](supabase/migrations/) | Ordered SQL migrations (apply in numeric order). |
| [`trigger.config.ts`](trigger.config.ts) | Trigger.dev project config (`project`, `runtime: node`, `maxDuration: 300`). |
| [`PDR.md`](PDR.md) | Full spec: data model, lifecycle, onboarding state machine, proxy spec, security, **and a how-to-extend guide**. |

## Database

Three Postgres tables (full DDL in [`supabase/migrations/`](supabase/migrations/)):

- **`user_sessions`** — per-user global state, onboarding step, profile metadata, encrypted Anthropic key, and the IDs of the provisioned Anthropic resources (agent, environment, vault, memory store, uploaded files, selected connectors).
- **`agent_conversations`** — mapping between Telegram chats and active Anthropic sessions (`is_active` flips on `/newchat`).
- **`processed_updates`** — idempotency cache of Telegram `update_id`s (5-minute window).

## Security

- **AES-GCM-256 at rest** — each user's API key is encrypted before storage ([`lib/crypto.ts`](lib/crypto.ts)) and decrypted only in volatile memory for outbound calls. Never logged or stored as plaintext. The bot never uses the operator's own key — only the per-user key the client pasted.
- **Idempotency** — Telegram `update_id`s are cached so duplicate webhook retries are dropped.
- **Strict boundaries** — the gateway never persists document content; Anthropic owns the data plane.

## Getting started

### Prerequisites
- Node 20+
- A Supabase project, a Telegram bot token (from @BotFather), a Trigger.dev project, and a 32-byte hex encryption key.

### 1. Install
```bash
npm install
```

### 2. Environment variables (`.env` in repo root — not committed)
```
TELEGRAM_BOT_TOKEN=        # from @BotFather
SUPABASE_URL=              # https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY= # service role key (server-side only)
TRIGGER_SECRET_KEY=        # tr_dev_... for local dev
ENCRYPTION_KEY=            # 64-char hex (32 bytes) for AES-GCM-256
TELEGRAM_WEBHOOK_SECRET=   # shared secret echoed by Telegram to authenticate the webhook
MCP_EMAIL_URL=             # hosted MCP endpoint for the email connector (optional until go-live)
MCP_CALENDAR_URL=          # hosted MCP endpoint for the calendar connector
```
> `ENCRYPTION_KEY` must be exactly 64 hex chars. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 3. Apply database migrations
Run each file in [`supabase/migrations/`](supabase/migrations/) **in numeric order** in the Supabase SQL editor (001 → 002 → 003). RLS is intentionally disabled (server-side service-role access only).

### 4. Run the worker locally
```bash
npm run dev      # starts the Trigger.dev v4 dev worker (runs tasks on your machine)
```

### 5. Point Telegram at the webhook
Deploy [`api/webhook.ts`](api/webhook.ts) to Vercel (with `TELEGRAM_WEBHOOK_SECRET` set in the Vercel env **first**), then register the webhook with the same secret:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>.vercel.app/api/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
Telegram echoes `secret_token` back in the `X-Telegram-Bot-Api-Secret-Token` header on every update; the handler rejects any request that doesn't match (and fails closed if the env var is unset). Message the bot on Telegram to start onboarding.

> **Local dev note:** Vercel receives the webhook and enqueues the Trigger.dev task; the task itself executes wherever the worker runs. In dev that's your machine (`npm run dev`). To run the worker in the cloud, `npm run deploy` and set the same env vars in the Trigger.dev dashboard.

## Documentation

- **[PDR.md](PDR.md)** — full Product Development Requirements: data model, execution lifecycle, onboarding state machine, proxy router spec, security constraints, **current status / roadmap, and a step-by-step "how to add a feature" guide.**
