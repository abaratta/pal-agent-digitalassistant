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
};

function systemPromptFor(profile: {
  user_name: string | null;
  company: string | null;
}): string {
  return [
    `You are the personal digital Chief of Staff for ${profile.user_name ?? "the user"}`,
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

  const environment = await anthropic.beta.environments.create({
    name: `pal-${Date.now()}`,
    config: { type: "cloud", networking: { type: "unrestricted" } },
  } as any);

  const agent = await anthropic.beta.agents.create({
    name: "Digital Chief of Staff",
    model: MODEL,
    system: systemPromptFor(profile),
    tools: [{ type: "agent_toolset_20260401" }],
  } as any);

  const vault = await anthropic.beta.vaults.create({
    display_name: `pal-${(agent as any).id}`,
  } as any);

  return {
    agentId: (agent as any).id,
    agentVersion: (agent as any).version,
    environmentId: (environment as any).id,
    vaultId: (vault as any).id,
  };
}

// Re-declare the agent's MCP servers + toolset for the selected connectors.
// Returns the new agent version.
export async function setAgentConnectors(
  apiKey: string,
  agentId: string,
  connectors: ConnectorKey[],
): Promise<number> {
  const anthropic = client(apiKey);

  const mcpServers = connectors.map((k) => ({
    type: "url",
    name: CONNECTORS[k].mcpName,
    url: CONNECTORS[k].url,
  }));

  const tools: any[] = [{ type: "agent_toolset_20260401" }];
  for (const k of connectors) {
    tools.push({ type: "mcp_toolset", mcp_server_name: CONNECTORS[k].mcpName });
  }

  const updated = await anthropic.beta.agents.update(agentId, {
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
    fileIds: string[];
  },
): Promise<string> {
  const anthropic = client(apiKey);

  const resources = opts.fileIds.map((fileId, i) => ({
    type: "file",
    file_id: fileId,
    mount_path: `/workspace/knowledge/file_${i}`,
  }));

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
