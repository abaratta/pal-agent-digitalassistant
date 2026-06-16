# Product Development Requirements (PDR)

**Project Name:** Unified Telegram Gateway for Anthropic Managed Agents ("Digital Personal Assistant")
**Target Architecture:** Vercel (Serverless Gateway) + Trigger.dev v4 (Asynchronous Core) + Supabase (State/Vault Database) + Anthropic Managed Agents (Runtime)
**Version:** 2.0 — *reflects the as-built implementation, not the original spec.*
**Last updated:** 2026-06-16

> **How to read this document.** §1–§6 describe the system as it is actually built (the code is the source of truth; file references are given throughout). §7 is the live **status & roadmap** — what works, what's pending, known issues. §8 is a **how-to-extend** guide for adding features. If you are picking this project up cold, read §1, then §7, then jump to the code file relevant to your task.

---

## 1. System Overview

A single, multi-tenant Telegram bot that serves as an intelligent front-end for custom cloud-hosted AI agents. Rather than one bot per client, this unified app routes incoming messages to per-client agent instances using per-user state in Postgres.

Each user supplies **their own** Anthropic API key during onboarding. The bot uses that key to provision a dedicated set of Anthropic resources for them and thereafter proxies chat between Telegram and that agent. The operator's own Anthropic key is never used at runtime.

The application operates in two modes per user, branched on `user_sessions.onboarding_completed`:

1. **Onboarding State (Linear Wizard)** — Collects profile info; captures + encrypts the client's Anthropic key; **provisions an Agent + Environment + Vault + Memory Store**; forwards uploaded documents to the Anthropic Files API; and lets the user select MCP connectors via an inline keyboard, declaring them on the agent config.
2. **Operational State (Agent Proxy Router)** — Forwards prompts to the user's Managed Agent, maintains an active session per chat thread, and streams the reply back into a single Telegram message via throttled edits.

---

## 2. Database Schema (Supabase / PostgreSQL)

The schema is maintained as ordered migrations in [`supabase/migrations/`](supabase/migrations/). Apply them in numeric order. RLS is intentionally **off** — access is server-side only via the service-role key.

### 2.1 `user_sessions` — per-user global state
Created in `001_initial_schema.sql`, extended by `002` and `003`. Effective columns:

| Column | Type | Source | Notes |
| --- | --- | --- | --- |
| `telegram_chat_id` | BIGINT PK | 001 | Tenant identity. |
| `onboarding_completed` | BOOLEAN | 001 | Mode switch. |
| `current_step` | VARCHAR(50) | 001 | State-machine cursor (default `collect_name`). |
| `user_name`, `email`, `company`, `website` | VARCHAR | 001 | Profile. |
| `encrypted_anthropic_key` | TEXT | 001 | AES-GCM-256, format `ivB64:ctB64`. |
| `anthropic_agent_id` | VARCHAR | 001 | Provisioned agent. |
| `anthropic_environment_id` | VARCHAR | 001 | Provisioned environment. |
| `anthropic_vault_id` | VARCHAR | 002 | For MCP connector credentials. |
| `anthropic_file_ids` | TEXT[] | 002 | Uploaded knowledge-base file IDs. |
| `mcp_connectors` | TEXT[] | 002 | Selected connector keys. |
| `anthropic_memory_store_id` | VARCHAR | 003 | Persistent cross-session memory. |
| `created_at`, `updated_at` | TIMESTAMPTZ | 001 | `updated_at` maintained by trigger. |

### 2.2 `agent_conversations` — Telegram thread ↔ Anthropic session map
(`001`) `id`, `telegram_chat_id` (FK, cascade), `anthropic_session_id`, `is_active`, timestamps. `/newchat` flips `is_active` to false so the next message creates a fresh session.

### 2.3 `processed_updates` — idempotency cache
(`001`) `update_id` PK + `created_at`. Telegram retries are dropped if the `update_id` was already seen. Intended 5-minute purge via `pg_cron` (commented schedule in the migration).

The row shapes are mirrored in TypeScript as `UserSession` / `AgentConversation` in [`lib/supabase.ts`](lib/supabase.ts) — **keep them in sync when adding a column.**

---

## 3. Execution Lifecycle

Incoming network confirmation is fully decoupled from long-running execution so Telegram always gets a fast 200.

```
[User Telegram App] ──(text / file / button tap)──▶ [Vercel: api/webhook.ts]
                                                            │ (instant 200 OK; enqueue task)
                                                            ▼
                                              [Trigger.dev: route-telegram-event]
                                                            │  dedupe → load/create session
                                       ┌────────────────────┴────────────────────┐
                          onboarding_completed = false              onboarding_completed = true
                                       ▼                                          ▼
                          handleOnboardingStep()                       handleAgentProxyChat()
                          (trigger/onboarding.ts)                       (trigger/agent.ts)
```

### 3.1 Vercel gateway — [`api/webhook.ts`](api/webhook.ts)
Accepts POST only. Handles two update shapes:
- **`callback_query`** (inline-button tap): enqueues with `text: ""` and a `callback: { id, data }` payload.
- **`message`** (text or document): enqueues `chatId`, `text`, `document`, `updateId`, `callback: null`.

Returns `{ ok: true }` immediately; all real work happens in the task.

### 3.2 Router task — [`trigger/router.ts`](trigger/router.ts)
1. Loads `.env` by absolute path (the dev worker uses its own cwd) and imports [`lib/netfix.ts`](lib/netfix.ts) to force IPv4.
2. **Idempotency:** look up `update_id` in `processed_updates`; skip if seen, else insert.
3. Load `user_sessions` row; create one (default `current_step = collect_name`) if absent.
4. Normalize `/start` → empty text (so the welcome prompt fires).
5. Branch to `handleOnboardingStep` or `handleAgentProxyChat`.

The shared payload type is `TelegramEventPayload` (exported from `router.ts`).

---

## 4. Phase 1 — Onboarding Engine — [`trigger/onboarding.ts`](trigger/onboarding.ts)

A `switch (current_step)` state machine. **Critical ordering rule:** always `sendMessage` the *next* prompt **before** calling `updateSession` to advance `current_step`. A failed send must never silently skip a step (this bug bit us once during the IPv6 outage).

### 4.1 Steps

| `current_step` | Action | Next |
| --- | --- | --- |
| `collect_name` | Prompt for full name. | `collect_email` |
| `collect_email` | Validate with `EMAIL_REGEX`. | `collect_company` |
| `collect_company` | Capture org name. | `collect_website` |
| `collect_website` | Capture site URL, then ask for the Anthropic key. | `collect_anthropic_key` |
| `collect_anthropic_key` | Validate `sk-ant-` prefix → **`provisionAgent()`** (also validates the key) → encrypt key → store agent/env/vault/memory IDs. | `upload_knowledge_base` |
| `upload_knowledge_base` | For each attached file: download from Telegram, `uploadKnowledgeFile()` to Anthropic, append the file ID. `/skip` advances. | `configure_mcp` |
| `configure_mcp` | Render the connector inline keyboard; button taps drive selection. | `operational` |

### 4.2 Provisioning — `provisionAgent()` in [`lib/anthropic.ts`](lib/anthropic.ts)
On key capture, creates in one shot: an **Environment** (`cloud`, unrestricted networking), an **Agent** (`claude-opus-4-8`, Chief-of-Staff system prompt, `agent_toolset_20260401`, `metadata.created_at`), a **Vault** (for MCP creds), and a **Memory Store** (persistent context). Returns all IDs, persisted to `user_sessions`.

### 4.3 Knowledge files — `uploadKnowledgeFile()`
Downloads the Telegram file to memory and uploads to the Anthropic Files API (`purpose: "agent"`, beta `files-api-2025-04-14`). Files are **not** bound to the agent here — they are mounted per-session at chat time (§5).

### 4.4 MCP connectors — connector menu + `setAgentConnectors()`
The connector registry is `CONNECTORS` in [`lib/anthropic.ts`](lib/anthropic.ts) (currently `email`, `calendar`; URLs env-overridable via `MCP_EMAIL_URL` / `MCP_CALENDAR_URL`). The inline keyboard (`renderConnectorMenu`) lets the user toggle connectors; **Done** calls `setAgentConnectors()`, which:
- **Retrieves the agent first to read its current `version`** (the API uses optimistic locking — updating without `version` returns `400 version: Field required`).
- Re-declares `mcp_servers` + a `mcp_toolset` per connector + the base `agent_toolset_20260401`, all with `permission_policy: always_allow`.

OAuth for each connector is **manual**: the user finishes authorizing in the Anthropic console (we point them there). This is the deliberate "manual MCP" approach.

---

## 5. Phase 2 — Operational Proxy — [`trigger/agent.ts`](trigger/agent.ts)

1. **`/newchat`** → mark the active `agent_conversations` row inactive and confirm. Next message starts fresh.
2. Resolve the active Anthropic session for the chat; if none, **`createSession()`** ([`lib/anthropic.ts`](lib/anthropic.ts)) mounting: each knowledge file as a `file` resource, the memory store as a `read_write` `memory_store` resource, and the vault via `vault_ids`. Persist the new session in `agent_conversations`.
3. Post a `⏳ Thinking…` placeholder, then **`runPrompt()`** streams the reply.

### 5.1 Streaming — `runPrompt()`
Uses the real Managed Agents sessions API (the v1 PDR's `agents.sessions.messages.create` shape was hallucinated and does not exist):
- **Stream-first:** open `sessions.events.stream(sessionId)` **before** `sessions.events.send(...)` — the stream only delivers events emitted after it opens.
- Accumulate text from `agent.message` events; flush to Telegram via `editMessage` **no more than every 1200ms** (rate-limit guard).
- Break on `session.status_terminated`, or `session.status_idle` unless `stop_reason.type === "requires_action"`.
- All text is MarkdownV2-escaped via `escapeMd` before sending.

---

## 6. Security & Non-Functional Constraints

- **Webhook authentication** ([`api/webhook.ts`](api/webhook.ts)) — Telegram echoes the `secret_token` registered via `setWebhook` in the `X-Telegram-Bot-Api-Secret-Token` header. The handler rejects any request whose header doesn't match `TELEGRAM_WEBHOOK_SECRET`, and **fails closed** (500) if that env var is unset. Without this, a forged POST with an arbitrary `chat.id` could drive another user's agent — and with MCP tools set to `always_allow`, trigger auto-approved tool calls under the victim's credentials.
- **AES-GCM-256 at rest** ([`lib/crypto.ts`](lib/crypto.ts)) — per-user keys encrypted as `ivB64:ctB64`; decrypted only in memory for outbound calls. Never logged/stored plaintext. `ENCRYPTION_KEY` is 64 hex chars (32 bytes).
- **Idempotency** — `update_id`s cached in `processed_updates`; duplicates dropped.
- **Proxy-only boundary** — no local tokenizers, chunking, vector indices, or model instances. Indexing/analysis/storage all live in Anthropic's managed infra.
- **IPv4 forcing** ([`lib/netfix.ts`](lib/netfix.ts)) — dev-only network workaround; harmless in cloud.

---

## 7. Current Status & Roadmap

### 7.1 Working (verified in local dev)
- ✅ Webhook → Trigger.dev → branch routing, with `update_id` idempotency.
- ✅ Full onboarding wizard: profile → key capture → real provisioning (agent/env/vault/memory) → file upload → MCP connector selection.
- ✅ `setAgentConnectors` with optimistic-lock `version` handling.
- ✅ Operational proxy: session create with file + memory + vault resources, throttled streaming back to Telegram.
- ✅ AES-GCM-256 key encryption; MarkdownV2 escaping; `/newchat` reset.
- ✅ Webhook authentication via `TELEGRAM_WEBHOOK_SECRET` (fail-closed; see §6). Requires `setWebhook` to be re-registered with the matching `secret_token`.

### 7.2 Pending / TODO
- ⏳ **Run the Trigger.dev worker in the cloud** (`npm run deploy`) instead of local `npm run dev`; set env vars in the Trigger.dev dashboard.
- ⏳ **Real MCP endpoint URLs** — `MCP_EMAIL_URL` / `MCP_CALENDAR_URL` are placeholders (`https://mcp.example.com/...`). Set real hosted MCP servers before go-live, in both Vercel and Trigger.dev env.
- ⏳ **`pg_cron` purge** for `processed_updates` (schedule is commented in `001`). Without it the table grows unbounded.
- ⏳ **Telegram message chunking** — replies over Telegram's 4096-char limit will fail the final `editMessage`. Add splitting.
- ⏳ **Error surfacing to the user** in the proxy path (currently a thrown error just fails the run; the placeholder bubble stays "Thinking…").
- ⏳ **Deep-link onboarding** (`/start <token>`) for assigning users to pre-created agents — referenced in the original concept, not yet built.
- ⏳ **Supabase RLS** as defense-in-depth — isolation currently relies entirely on every query being scoped by `telegram_chat_id`. RLS would catch a future query that forgets it. (Webhook auth, above, is now in place.)

### 7.3 Known issues / gotchas
- Connector OAuth is **manual** in the Anthropic console — not automated.
- `mcp_connectors` selections persist per toggle, but `setAgentConnectors` only runs on **Done**.
- Files deleted via `files.delete` (`DELETE /v1/files/{id}`) may linger in the console UI due to caching; deletion no-ops silently if the key/workspace doesn't own the file.

---

## 8. How to Add a Feature

General rule: **the code is the source of truth.** When you change behavior, update the relevant file, keep `UserSession` in [`lib/supabase.ts`](lib/supabase.ts) in sync with the DB, and update §2/§7 here.

### 8.1 Add an onboarding step
1. Add a `case "<new_step>"` to the `switch` in [`trigger/onboarding.ts`](trigger/onboarding.ts).
2. Wire it into the chain: the prior step's `updateSession({ current_step: "<new_step>" })`.
3. **Send the prompt before advancing state** (the ordering rule, §4).
4. If it stores data, add the column (new migration), add it to `UserSession`, and to the `updateSession` call.

### 8.2 Add a new MCP connector
1. Add an entry to `CONNECTORS` in [`lib/anthropic.ts`](lib/anthropic.ts): `{ label, mcpName, url: process.env.MCP_<X>_URL || "<placeholder>" }`.
2. Set the env var in `.env`, Vercel, and Trigger.dev.
3. That's it — `renderConnectorMenu` and `setAgentConnectors` are both driven off the `CONNECTORS` map, so the UI and agent config pick it up automatically.

### 8.3 Add a new database column
1. New file `supabase/migrations/00N_<name>.sql` using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
2. Apply it in the Supabase SQL editor.
3. Add the field to the `UserSession` type in [`lib/supabase.ts`](lib/supabase.ts).
4. Read/write it where needed.

### 8.4 Add a bot command (e.g. `/status`)
Handle it early in `handleAgentProxyChat` ([`trigger/agent.ts`](trigger/agent.ts)) — mirror the existing `/newchat` block (match on `text.trim()`, do the work, `return`). Onboarding-time commands go in `handleOnboardingStep` instead.

### 8.5 Change the agent's model or system prompt
Edit `MODEL` and `systemPromptFor()` in [`lib/anthropic.ts`](lib/anthropic.ts). Note: existing users already have provisioned agents — changes only affect **newly** provisioned ones unless you also push an `agents.update` (remember the optimistic-lock `version`).

### 8.6 Local testing loop
`npm run dev` (worker) + Vercel webhook pointed at your deployment. To reset a tenant, delete their `user_sessions` row (and `agent_conversations` rows) in Supabase; the next message re-runs onboarding from `collect_name`. Use `npm run typecheck` before committing.
