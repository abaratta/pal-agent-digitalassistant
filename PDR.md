# Product Development Requirements (PDR)

**Project Name:** Unified Telegram Gateway for Anthropic Managed Agents
**Target Architecture:** Vercel (Serverless Gateway) + Trigger.dev v3 (Asynchronous Core) + Supabase (State/Vault Database)
**Version:** 1.1 (Includes Session State Tracking & Extended Multi-Tenancy Logic)

---

## 1. System Overview

The objective of this project is to build a single, multi-tenant Telegram Bot that serves as an intelligent front-end interface for custom cloud-hosted AI agents. Instead of creating a separate Telegram bot per client, this unified application routes incoming messages to unique client agent instances using **Deep Linking** and state-based filtering.

The application operates in two distinct functional modes on a per-user basis:

1. **Onboarding State (Linear Wizard):** Gathers basic profiling information, captures the client's encrypted Anthropic API Key, forwards uploaded organizational documentation directly to Anthropic's hosted Files API, and presents manual setup guides for Model Context Protocol (MCP) servers.
2. **Operational State (Agent Proxy Router with Contextual Memory):** Intercepts natural language prompts and seamlessly forwards them to the client's Anthropic Managed Agent instance. It maintains conversation continuity by managing state across individual chat threads, updating message strings dynamically using Telegram's formatting syntax.

---

## 2. Database Schema (Supabase / PostgreSQL)

The backend engine relies on two relational tables to map tenant profiles and monitor live conversations.

### 2.1 Table: `user_sessions`

Tracks the global state, configuration attributes, and core identity data for each registered user.

```sql
CREATE TABLE user_sessions (
    telegram_chat_id BIGINT PRIMARY KEY,
    onboarding_completed BOOLEAN DEFAULT FALSE,
    current_step VARCHAR(50) DEFAULT 'collect_name',

    -- Client Profile Metadata
    user_name VARCHAR(255),
    email VARCHAR(255),
    company VARCHAR(255),
    website VARCHAR(255),

    -- Encrypted Anthropic Integration Layer
    encrypted_anthropic_key TEXT,
    anthropic_agent_id VARCHAR(255),
    anthropic_environment_id VARCHAR(255),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index to optimize routing lookups
CREATE INDEX idx_user_onboarding ON user_sessions(telegram_chat_id, onboarding_completed);
```

### 2.2 Table: `agent_conversations`

Maintains long-term associations between continuous Telegram interactions and isolated Anthropic Agent workspace sessions.

```sql
CREATE TABLE agent_conversations (
    id BIGSERIAL PRIMARY KEY,
    telegram_chat_id BIGINT NOT NULL REFERENCES user_sessions(telegram_chat_id) ON DELETE CASCADE,
    anthropic_session_id VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for real-time thread lookup
CREATE INDEX idx_tg_chat_active ON agent_conversations(telegram_chat_id, is_active);
```

---

## 3. High-Level System Architecture & Execution Lifecycle

To manage chat payloads efficiently and prevent packet delivery failures due to slow upstream generation, the engineering design completely decouples incoming network confirmation from the long-running execution process.

```
[User Telegram App] ──(1. Text/File Payload)──> [Vercel FastAPI Gateway]
                                                           │
                                                           │ (2. Immediate 200 OK Hand-off)
                                                           ▼
                                                [Trigger.dev Engine]
                                                           │
                                     ┌─────────────────────┴─────────────────────┐
                        [ onboarding_completed = false ]           [ onboarding_completed = true ]
                                     │                                           │
                                     ▼                                           ▼
                        Execute Sequential Wizard Flow             Resolve Thread ID & Stream Prompt
```

### 3.1 Vercel Gatekeeper Route (`/api/webhook.ts`)

This serverless handler processes the raw webhook packet sent by Telegram, sanitizes the transmission context, triggers the async task layer, and drops the connection within 200ms.

```typescript
import { tasks } from "@trigger.dev/sdk/v3";
import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  const payload = req.body;
  if (!payload || !payload.message) return res.status(200).send("OK");

  const chatId = payload.message.chat.id;
  const text = payload.message.text || "";
  const document = payload.message.document || null;

  // Delegate processing instantly to the Trigger.dev execution queue
  await tasks.trigger("route-telegram-event", { chatId, text, document });

  // Affirm message delivery instantly back to Telegram API
  return res.status(200).json({ ok: true });
}
```

### 3.2 Trigger.dev Routing Mechanism (`/trigger/router.ts`)

This background worker executes database queries to load context state and routes execution branches based on registration completion flags.

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { supabaseClient } from "../lib/supabase";

export const routeTelegramEvent = task({
  id: "route-telegram-event",
  run: async (payload: { chatId: number; text: string; document: any }) => {
    // Fetch profile state mapping
    let { data: session } = await supabaseClient
      .from("user_sessions")
      .select("*")
      .eq("telegram_chat_id", payload.chatId)
      .maybeSingle();

    // Instantiate profile if missing (deep linking fallback initialization)
    if (!session) {
      session = await createInitialSession(payload.chatId);
    }

    if (!session.onboarding_completed) {
      return await handleOnboardingStep(session, payload);
    } else {
      return await handleAgentProxyChat(session, payload);
    }
  }
});
```

---

## 4. Phase 1: Interactive Onboarding Engine Specification

When a user opens the bot through an onboarding deep-link, the system executes a structured state-machine flow across sequential milestones.

### 4.1 Onboarding Steps & State Changes

| State Name (`current_step`) | System Action / User Facing Prompt | Next State Destination |
| --- | --- | --- |
| `collect_name` | "Welcome! Please enter your full name to begin provisioning your Chief of Staff assistant:" | `collect_email` |
| `collect_email` | "Thank you. What is your preferred business email address?" (Enforce regex email checks) | `collect_company` |
| `collect_company` | "Please enter the legal or operational name of your organization/company:" | `collect_website` |
| `collect_website` | "What is your main company website URL?" | `collect_anthropic_key` |
| `collect_anthropic_key` | "Provide your secret Anthropic Developer API Key. This will be encrypted at rest in your secure agent profile workspace:" | `upload_knowledge_base` |
| `upload_knowledge_base` | "Onboarding verification successful! Please attach and upload your business knowledge documents (PDF, MD, TXT). Use the paperclip icon." | `configure_mcp` |
| `configure_mcp` | Renders system markdown implementation steps for activating MCP plugins in their console. | `operational` |

### 4.2 Document Forwarding Pipeline (Anthropic Files API Integration)

When a file is detected during the `upload_knowledge_base` phase, the worker must stream the data directly to the client's Anthropic console bucket:

1. Request raw storage file paths by requesting: `https://api.telegram.org/bot<TOKEN>/getFile?file_id=${payload.document.file_id}`.
2. Download the target document chunk stream into serverless runtime volatile memory.
3. Post the binary data payload directly to the **Anthropic Files API** endpoint (`https://api.anthropic.com/v1/files`) utilizing the customer's decrypted API key. Include the mandatory request header: `anthropic-beta: files-api-2025-04-14`.
4. Take the resulting remote file `id` and issue an agent configuration update request (`PATCH /v1/agents/{agent_id}`) with the header `anthropic-beta: managed-agents-2026-04-01` to bind the knowledge base file directly to the runtime instance.

### 4.3 MCP Onboarding Integration Layout

Once file synchronization tasks conclude, the worker pushes step-by-step setup guides to the user's screen along with interactive inline elements:

```markdown
🤖 *Step 6: Provisioning & Authorizing your MCP Connectors*

Your personal digital Chief of Staff is initialized! To enable enterprise tool integration (Email engines, Calendars, Social media accounts), you must authorize the connector infrastructure directly within your Anthropic developer space.

*Instructions:*
1️⃣ Access your secure Anthropic Developer Console.
2️⃣ Click on **Agent Profiles** and choose your active Assistant ID.
3️⃣ Navigate to **MCP Connected Server Vaults**, select your desired app, and enter your account login profiles.

[ 🌐 Open Anthropic Console ]  [ ✅ Setup Verification Complete ]
```

---

## 5. Phase 2: Operational Agent Proxy Router Specification

Once `onboarding_completed` evaluates to `true`, the conversational proxy engine takes over, processing interactions through continuous context windows.

### 5.1 Contextual State Mapping & Conversation Control Flow

The engine implements session rules using this execution schema:

```typescript
export async function handleAgentProxyChat(session: any, payload: { chatId: number; text: string }) {

  // 1. Intercept Global Thread Command to Reset the Workspace
  if (payload.text.trim() === "/new_chat") {
    await supabaseClient
      .from("agent_conversations")
      .update({ is_active: false })
      .eq("telegram_chat_id", payload.chatId)
      .eq("is_active", true);

    await sendTelegramMessage(payload.chatId, "🔄 Context cleared. A fresh conversation session has been initialized with your Chief of Staff.");
    return; // Drop out to let the next inbound token message trigger initialization
  }

  // 2. Query for a running, active Anthropic session ID map
  let { data: activeConv } = await supabaseClient
    .from("agent_conversations")
    .select("anthropic_session_id")
    .eq("telegram_chat_id", payload.chatId)
    .eq("is_active", true)
    .maybeSingle();

  let anthropicSessionId = activeConv?.anthropic_session_id;

  // 3. Lifecycle Initialization: Handle New Conversation Branch
  if (!anthropicSessionId) {
    const anthropic = new Anthropic({ apiKey: decryptApiKey(session.encrypted_anthropic_key) });

    // Call the Anthropic Managed Agents API to create a brand-new cloud workspace container
    // Requires header: anthropic-beta: managed-agents-2026-04-01
    const newSession = await anthropic.beta.agents.sessions.create({
      agent_id: session.anthropic_agent_id,
    });

    anthropicSessionId = newSession.id;

    // Persist session identity in Supabase database mapping
    await supabaseClient.from("agent_conversations").insert({
      telegram_chat_id: payload.chatId,
      anthropic_session_id: anthropicSessionId,
      is_active: true
    });
  }

  // 4. Thread Appending & Real-time Text Streaming Execution Loop
  // Dispatch prompt text to the active container session thread
  const msgStream = await anthropic.beta.agents.sessions.messages.create(
    session.anthropic_agent_id,
    anthropicSessionId,
    {
      role: "user",
      content: payload.text,
      stream: true
    }
  );

  // 5. Output Response Tailing Strategy
  // - Catch initial token generation chunks and issue a text bubble creation via `sendMessage`.
  // - As additional word groupings emerge, update the output target on screen using `editMessageText`.
  // - IMPLEMENTATION CONSTRAINT: Throttle UI update requests to a minimum of 1200ms intervals to safeguard against Telegram API rate limits.
  // - Ensure all generated Markdown syntax segments are completely escaped to meet Telegram's MarkdownV2 strict character parsing constraints.
}
```

---

## 6. Security Guarantees & Non-Functional Constraints

* **Cryptographic Protocol at Rest:** API tokens submitted by clients must never be logged or stored as plaintext. The application must encrypt values using symmetric AES-GCM-256 wrappers before updating records. Decryption should occur exclusively in volatile memory for immediate outbound API requests.
* **Network Idempotency Checkpoints:** To counter redundant delivery retries from Telegram during platform latency spikes, the routing layer must cache processing transaction identifiers (`update_id`) within an isolated schema key layer for 5 minutes, ignoring duplicate events.
* **Decoupled Architectural Boundaries:** The processing gateway is strictly proxy-only. The system must not run internal tokenizers, chunking utilities, document scanners, vector indices, or model instances. Content indexing, analysis, and data storage are fully offloaded to Anthropic's managed agent infrastructure.
