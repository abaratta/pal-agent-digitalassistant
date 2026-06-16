import {
  Anthropic
} from "./chunk-JZTUVUI6.mjs";
import {
  editMessage,
  escapeMd,
  sendMessage,
  supabaseClient
} from "./chunk-BAVEWFEL.mjs";
import {
  decryptApiKey
} from "./chunk-PJL4ULKY.mjs";
import {
  __name,
  init_esm
} from "./chunk-6ZPQH2JT.mjs";

// trigger/agent.ts
init_esm();
var STREAM_THROTTLE_MS = 1200;
async function handleAgentProxyChat(session, payload) {
  const { chatId, text } = payload;
  if (text.trim() === "/new_chat") {
    await supabaseClient.from("agent_conversations").update({ is_active: false }).eq("telegram_chat_id", chatId).eq("is_active", true);
    await sendMessage(chatId, escapeMd("🔄 Context cleared. A fresh conversation session has been initialized with your Chief of Staff."));
    return;
  }
  let { data: activeConv } = await supabaseClient.from("agent_conversations").select("anthropic_session_id").eq("telegram_chat_id", chatId).eq("is_active", true).maybeSingle();
  const apiKey = await decryptApiKey(session.encrypted_anthropic_key);
  const anthropic = new Anthropic({ apiKey });
  let anthropicSessionId = activeConv?.anthropic_session_id;
  if (!anthropicSessionId) {
    const newSession = await anthropic.beta.agents.sessions.create({
      agent_id: session.anthropic_agent_id
    }, {
      headers: { "anthropic-beta": "managed-agents-2026-04-01" }
    });
    anthropicSessionId = newSession.id;
    await supabaseClient.from("agent_conversations").insert({
      telegram_chat_id: chatId,
      anthropic_session_id: anthropicSessionId,
      is_active: true
    });
  }
  let telegramMessageId = await sendMessage(chatId, escapeMd("⏳ Thinking…"));
  let buffer = "";
  let lastEditAt = 0;
  const stream = await anthropic.beta.agents.sessions.messages.create(
    session.anthropic_agent_id,
    anthropicSessionId,
    { role: "user", content: text, stream: true },
    { headers: { "anthropic-beta": "managed-agents-2026-04-01" } }
  );
  for await (const chunk of stream) {
    const delta = chunk?.delta?.text ?? "";
    if (!delta) continue;
    buffer += delta;
    const now = Date.now();
    if (now - lastEditAt >= STREAM_THROTTLE_MS) {
      await editMessage(chatId, telegramMessageId, escapeMd(buffer));
      lastEditAt = now;
    }
  }
  if (buffer) {
    await editMessage(chatId, telegramMessageId, escapeMd(buffer));
  }
}
__name(handleAgentProxyChat, "handleAgentProxyChat");

export {
  handleAgentProxyChat
};
//# sourceMappingURL=chunk-CPV2GYPQ.mjs.map
