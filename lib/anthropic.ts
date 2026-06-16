import Anthropic, { toFile } from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";

// ---------------------------------------------------------------------------
// MCP connector registry
// ---------------------------------------------------------------------------
// "Manual MCP" approach: we declare these servers on the agent config and create
// an (empty) vault, then point the user at the Anthropic console to complete each
// connector's OAuth. Add new connectors here — the onboarding UI and agent config
// are both driven off this map.
//
// NOTE: the `url` values must point at real hosted MCP server endpoints. They are
// env-overridable so they can be set without a code change; the defaults below are
// placeholders and should be confirmed before go-live.
export type ConnectorKey = "email" | "calendar";

export const CONNECTORS: Record<
  ConnectorKey,
  { label: string; mcpName: string; url: string }
> = {
  email: {
    label: "Email (Gmail/Outlook)",
    mcpName: "email",
    url: process.env.MCP_EMAIL_URL || "https://mcp.example.com/email",
  },
  calendar: {
    label: "Calendar (Google)",
    mcpName: "calendar",
    url: process.env.MCP_CALENDAR_URL || "https://mcp.example.com/calendar",
  },
};

export function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

// ---------------------------------------------------------------------------
// Provisioning (run once during onboarding)
// ---------------------------------------------------------------------------

export type ProvisionResult = {
  agentId: string;
  agentVersion: number;
  environmentId: string;
  vaultId: string;
  memoryStoreId: string;
};

function systemPromptFor(profile: {
  user_name: string | null;
  company: string | null;
}): string {
  return [
    `You are the personal digital assistant for ${profile.user_name ?? "the user"}`,
    profile.company ? ` at ${profile.company}` : "",
    `. You help manage their work across email, calendar, and connected tools. `,
    `Be concise, proactive, and action-oriented. When you complete a task, confirm what you did in one or two sentences.`,
  ].join("");
}

export async function provisionAgent(
  apiKey: string,
  profile: { user_name: string | null; company: string | null },
): Promise<ProvisionResult> {
  const anthropic = client(apiKey);

  const nowIso = new Date().toISOString();

  const environment = await anthropic.beta.environments.create({
    name: `pal-${Date.now()}`,
    config: { type: "cloud", networking: { type: "unrestricted" } },
  } as any);

  const agent = await anthropic.beta.agents.create({
    name: "Digital Personal Assistant",
    model: MODEL,
    system: systemPromptFor(profile),
    tools: [{ type: "agent_toolset_20260401" }],
    metadata: { created_at: nowIso },
  } as any);

  const vault = await anthropic.beta.vaults.create({
    display_name: `pal-${(agent as any).id}`,
  } as any);

  const memoryStore = await anthropic.beta.memoryStores.create({
    name: `pal-${(agent as any).id}`,
    description: `Persistent memory for ${profile.user_name ?? "the user"}'s Digital Personal Assistant — preferences, ongoing context, and prior task notes.`,
    metadata: { created_at: nowIso },
  } as any);

  return {
    agentId: (agent as any).id,
    agentVersion: (agent as any).version,
    environmentId: (environment as any).id,
    vaultId: (vault as any).id,
    memoryStoreId: (memoryStore as any).id,
  };
}

// Re-declare the agent's MCP servers + toolset for the selected connectors,
// each set to always-allow. agents.update uses optimistic locking, so we read
// the current version first and pass it back. Returns the new agent version.
export async function setAgentConnectors(
  apiKey: string,
  agentId: string,
  connectors: ConnectorKey[],
): Promise<number> {
  const anthropic = client(apiKey);

  const current = await anthropic.beta.agents.retrieve(agentId);
  const version = (current as any).version;

  const mcpServers = connectors.map((k) => ({
    type: "url",
    name: CONNECTORS[k].mcpName,
    url: CONNECTORS[k].url,
  }));

  const tools: any[] = [
    {
      type: "agent_toolset_20260401",
      default_config: { enabled: true, permission_policy: { type: "always_allow" } },
    },
  ];
  for (const k of connectors) {
    tools.push({
      type: "mcp_toolset",
      mcp_server_name: CONNECTORS[k].mcpName,
      default_config: { enabled: true, permission_policy: { type: "always_allow" } },
    });
  }

  const updated = await anthropic.beta.agents.update(agentId, {
    version,
    mcp_servers: mcpServers,
    tools,
  } as any);

  return (updated as any).version;
}

// ---------------------------------------------------------------------------
// Files (knowledge base) — uploaded once, mounted per session
// ---------------------------------------------------------------------------

export async function uploadKnowledgeFile(
  apiKey: string,
  data: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const anthropic = client(apiKey);
  const file = await anthropic.beta.files.upload({
    file: await toFile(Buffer.from(data), filename, { type: mimeType }),
    purpose: "agent",
  } as any);
  return (file as any).id;
}

// ---------------------------------------------------------------------------
// Sessions (per conversation)
// ---------------------------------------------------------------------------

export async function createSession(
  apiKey: string,
  opts: {
    agentId: string;
    environmentId: string;
    vaultId: string | null;
    memoryStoreId: string | null;
    fileIds: string[];
  },
): Promise<string> {
  const anthropic = client(apiKey);

  const resources: any[] = opts.fileIds.map((fileId, i) => ({
    type: "file",
    file_id: fileId,
    mount_path: `/workspace/knowledge/file_${i}`,
  }));

  // Memory stores attach via resources at session-create time only.
  if (opts.memoryStoreId) {
    resources.push({
      type: "memory_store",
      memory_store_id: opts.memoryStoreId,
      access: "read_write",
      instructions: "Your long-term memory. Check it before starting a task, and record preferences and useful context as you go.",
    });
  }

  const session = await anthropic.beta.sessions.create({
    agent: opts.agentId,
    environment_id: opts.environmentId,
    ...(opts.vaultId ? { vault_ids: [opts.vaultId] } : {}),
    ...(resources.length ? { resources } : {}),
  } as any);

  return (session as any).id;
}

// Send a prompt and stream the agent's text reply. `onUpdate` is called with the
// accumulated text as it grows; the final full text is returned.
export async function runPrompt(
  apiKey: string,
  sessionId: string,
  text: string,
  onUpdate: (fullText: string) => Promise<void>,
): Promise<string> {
  const anthropic = client(apiKey);

  // Stream-first, then send (the stream only delivers events emitted after it opens).
  const stream = await anthropic.beta.sessions.events.stream(sessionId);
  await anthropic.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  } as any);

  let buffer = "";
  let lastSentAt = 0;
  const THROTTLE_MS = 1200;

  for await (const event of stream as any) {
    if (event.type === "agent.message") {
      for (const block of event.content ?? []) {
        if (block.type === "text") buffer += block.text;
      }
      const now = Date.now();
      if (buffer && now - lastSentAt >= THROTTLE_MS) {
        await onUpdate(buffer);
        lastSentAt = now;
      }
    } else if (event.type === "session.status_terminated") {
      break;
    } else if (event.type === "session.status_idle") {
      if (event.stop_reason?.type === "requires_action") continue;
      break;
    }
  }

  return buffer;
}
