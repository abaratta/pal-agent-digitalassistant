import {
  answerCallback,
  decryptApiKey,
  encryptApiKey,
  escapeMd,
  getFileUrl,
  sendKeyboard,
  sendMessage,
  supabaseClient
} from "./chunk-25ICGNZE.mjs";
import {
  Anthropic,
  toFile
} from "./chunk-3XHGXCJ5.mjs";
import {
  __name,
  init_esm
} from "./chunk-6ZPQH2JT.mjs";

// trigger/onboarding.ts
init_esm();

// lib/anthropic.ts
init_esm();
var MODEL = "claude-opus-4-8";
var CONNECTORS = {
  email: {
    label: "Email (Gmail/Outlook)",
    mcpName: "email",
    url: process.env.MCP_EMAIL_URL || "https://mcp.example.com/email"
  },
  calendar: {
    label: "Calendar (Google)",
    mcpName: "calendar",
    url: process.env.MCP_CALENDAR_URL || "https://mcp.example.com/calendar"
  }
};
function client(apiKey) {
  return new Anthropic({ apiKey });
}
__name(client, "client");
function systemPromptFor(profile) {
  return [
    `You are the personal digital Chief of Staff for ${profile.user_name ?? "the user"}`,
    profile.company ? ` at ${profile.company}` : "",
    `. You help manage their work across email, calendar, and connected tools. `,
    `Be concise, proactive, and action-oriented. When you complete a task, confirm what you did in one or two sentences.`
  ].join("");
}
__name(systemPromptFor, "systemPromptFor");
async function provisionAgent(apiKey, profile) {
  const anthropic = client(apiKey);
  const environment = await anthropic.beta.environments.create({
    name: `pal-${Date.now()}`,
    config: { type: "cloud", networking: { type: "unrestricted" } }
  });
  const agent = await anthropic.beta.agents.create({
    name: "Digital Chief of Staff",
    model: MODEL,
    system: systemPromptFor(profile),
    tools: [{ type: "agent_toolset_20260401" }]
  });
  const vault = await anthropic.beta.vaults.create({
    display_name: `pal-${agent.id}`
  });
  return {
    agentId: agent.id,
    agentVersion: agent.version,
    environmentId: environment.id,
    vaultId: vault.id
  };
}
__name(provisionAgent, "provisionAgent");
async function setAgentConnectors(apiKey, agentId, connectors) {
  const anthropic = client(apiKey);
  const mcpServers = connectors.map((k) => ({
    type: "url",
    name: CONNECTORS[k].mcpName,
    url: CONNECTORS[k].url
  }));
  const tools = [{ type: "agent_toolset_20260401" }];
  for (const k of connectors) {
    tools.push({ type: "mcp_toolset", mcp_server_name: CONNECTORS[k].mcpName });
  }
  const updated = await anthropic.beta.agents.update(agentId, {
    mcp_servers: mcpServers,
    tools
  });
  return updated.version;
}
__name(setAgentConnectors, "setAgentConnectors");
async function uploadKnowledgeFile(apiKey, data, filename, mimeType) {
  const anthropic = client(apiKey);
  const file = await anthropic.beta.files.upload({
    file: await toFile(Buffer.from(data), filename, { type: mimeType }),
    purpose: "agent"
  });
  return file.id;
}
__name(uploadKnowledgeFile, "uploadKnowledgeFile");

// trigger/onboarding.ts
var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var CONSOLE_URL = "https://platform.claude.com";
async function handleOnboardingStep(session, payload) {
  const { chatId, text, document, callback } = payload;
  const step = session.current_step;
  switch (step) {
    case "collect_name": {
      if (!text.trim()) {
        await sendMessage(chatId, escapeMd("Welcome! Please enter your full name to begin provisioning your Chief of Staff assistant:"));
        return;
      }
      await sendMessage(chatId, escapeMd(`Thank you, ${text.trim()}! What is your preferred business email address?`));
      await updateSession(chatId, { user_name: text.trim(), current_step: "collect_email" });
      break;
    }
    case "collect_email": {
      if (!EMAIL_REGEX.test(text.trim())) {
        await sendMessage(chatId, escapeMd("That doesn't look like a valid email. Please enter your business email address:"));
        return;
      }
      await sendMessage(chatId, escapeMd("Please enter the legal or operational name of your organization/company:"));
      await updateSession(chatId, { email: text.trim(), current_step: "collect_company" });
      break;
    }
    case "collect_company": {
      if (!text.trim()) return;
      await sendMessage(chatId, escapeMd("What is your main company website URL?"));
      await updateSession(chatId, { company: text.trim(), current_step: "collect_website" });
      break;
    }
    case "collect_website": {
      if (!text.trim()) return;
      await sendMessage(
        chatId,
        escapeMd("Provide your secret Anthropic Developer API Key. This will be encrypted at rest in your secure agent profile workspace:")
      );
      await updateSession(chatId, { website: text.trim(), current_step: "collect_anthropic_key" });
      break;
    }
    case "collect_anthropic_key": {
      const key = text.trim();
      if (!key.startsWith("sk-ant-")) {
        await sendMessage(chatId, escapeMd("That doesn't look like a valid Anthropic API key. It should start with sk-ant-. Please try again:"));
        return;
      }
      await sendMessage(chatId, escapeMd("🔧 Provisioning your agent workspace… this takes a few seconds."));
      let provision;
      try {
        provision = await provisionAgent(key, { user_name: session.user_name, company: session.company });
      } catch (err) {
        await sendMessage(chatId, escapeMd(`I couldn't provision your agent with that key (${err?.message ?? "unknown error"}). Please double-check the key and paste it again:`));
        return;
      }
      const encryptedKey = await encryptApiKey(key);
      await sendMessage(
        chatId,
        escapeMd("✅ Agent provisioned and API key encrypted!\n\nNow attach your business knowledge documents (PDF, MD, TXT) using the paperclip icon. Send /skip to proceed without documents.")
      );
      await updateSession(chatId, {
        encrypted_anthropic_key: encryptedKey,
        anthropic_agent_id: provision.agentId,
        anthropic_environment_id: provision.environmentId,
        anthropic_vault_id: provision.vaultId,
        current_step: "upload_knowledge_base"
      });
      break;
    }
    case "upload_knowledge_base": {
      if (text.trim() === "/skip") {
        await updateSession(chatId, { current_step: "configure_mcp" });
        await renderConnectorMenu(chatId, []);
        return;
      }
      if (!document) {
        await sendMessage(chatId, escapeMd("Please attach a file (PDF, MD, or TXT) or send /skip to continue."));
        return;
      }
      const apiKey = await decryptApiKey(session.encrypted_anthropic_key);
      const fileUrl = await getFileUrl(document.file_id);
      const fileRes = await fetch(fileUrl);
      const fileBuffer = await fileRes.arrayBuffer();
      const fileId = await uploadKnowledgeFile(apiKey, fileBuffer, document.file_name, document.mime_type);
      await supabaseClient.from("user_sessions").update({ anthropic_file_ids: [...session.anthropic_file_ids, fileId], updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("telegram_chat_id", chatId);
      await sendMessage(chatId, escapeMd("📎 Document uploaded to your knowledge base! Send another file or /skip to continue."));
      break;
    }
    case "configure_mcp": {
      if (callback) {
        await handleConnectorCallback(session, callback);
        return;
      }
      await renderConnectorMenu(chatId, currentConnectors(session));
      break;
    }
  }
}
__name(handleOnboardingStep, "handleOnboardingStep");
function currentConnectors(session) {
  return session.mcp_connectors.filter((c) => c in CONNECTORS);
}
__name(currentConnectors, "currentConnectors");
async function renderConnectorMenu(chatId, selected) {
  const rows = Object.keys(CONNECTORS).map((key) => {
    const checked = selected.includes(key) ? "✅ " : "▫️ ";
    return [{ text: `${checked}${CONNECTORS[key].label}`, callback_data: `mcp:${key}` }];
  });
  rows.push([{ text: "✅ Done — Activate assistant", callback_data: "mcp:done" }]);
  await sendKeyboard(
    chatId,
    escapeMd("🤖 Step 6: Connect your tools\n\nSelect which connectors to enable, then tap Done. You'll finish authorizing each one in the Anthropic console."),
    rows
  );
}
__name(renderConnectorMenu, "renderConnectorMenu");
async function handleConnectorCallback(session, callback) {
  const chatId = session.telegram_chat_id;
  const action = callback.data.replace("mcp:", "");
  let selected = currentConnectors(session);
  if (action === "done") {
    const apiKey = await decryptApiKey(session.encrypted_anthropic_key);
    if (selected.length) {
      await setAgentConnectors(apiKey, session.anthropic_agent_id, selected);
    }
    await answerCallback(callback.id, "Activating…");
    await updateSession(chatId, { onboarding_completed: true, current_step: "operational" });
    const list = selected.length ? selected.map((k) => `• ${CONNECTORS[k].label}`).join("\n") : "(none selected)";
    await sendMessage(
      chatId,
      escapeMd(
        `🎉 Your Chief of Staff is live!

Connectors declared:
${list}

To finish authorizing them, open your Anthropic console, find your agent's vault, and complete the OAuth login for each connector:
${CONSOLE_URL}

You can start chatting now — just send me a message.`
      )
    );
    return;
  }
  if (action in CONNECTORS) {
    const key = action;
    if (selected.includes(key)) {
      selected = selected.filter((k) => k !== key);
      await answerCallback(callback.id, `${CONNECTORS[key].label} removed`);
    } else {
      selected = [...selected, key];
      await answerCallback(callback.id, `${CONNECTORS[key].label} added`);
    }
    await updateSession(chatId, { mcp_connectors: selected });
  } else {
    await answerCallback(callback.id);
  }
}
__name(handleConnectorCallback, "handleConnectorCallback");
async function updateSession(chatId, fields) {
  await supabaseClient.from("user_sessions").update({ ...fields, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("telegram_chat_id", chatId);
}
__name(updateSession, "updateSession");

export {
  handleOnboardingStep
};
//# sourceMappingURL=chunk-KFLFDUUP.mjs.map
