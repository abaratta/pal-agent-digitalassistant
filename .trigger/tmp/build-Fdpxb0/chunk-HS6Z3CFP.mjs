import {
  createSession,
  decryptApiKey,
  editMessage,
  escapeMd,
  runPrompt,
  sendMessage,
  supabaseClient
} from "./chunk-DV5TXCEE.mjs";
import {
  __name,
  init_esm
} from "./chunk-6ZPQH2JT.mjs";

// trigger/agent.ts
init_esm();
async function handleAgentProxyChat(session, payload) {
  const { chatId, text } = payload;
  if (text.trim() === "/new_chat") {
    await supabaseClient.from("agent_conversations").update({ is_active: false }).eq("telegram_chat_id", chatId).eq("is_active", true);
    await sendMessage(chatId, escapeMd("🔄 Context cleared. A fresh conversation session has been initialized with your Chief of Staff."));
    return;
  }
  if (!text.trim()) return;
  const apiKey = await decryptApiKey(session.encrypted_anthropic_key);
  const { data: activeConv } = await supabaseClient.from("agent_conversations").select("anthropic_session_id").eq("telegram_chat_id", chatId).eq("is_active", true).maybeSingle();
  let anthropicSessionId = activeConv?.anthropic_session_id;
  if (!anthropicSessionId) {
    anthropicSessionId = await createSession(apiKey, {
      agentId: session.anthropic_agent_id,
      environmentId: session.anthropic_environment_id,
      vaultId: session.anthropic_vault_id,
      fileIds: session.anthropic_file_ids
    });
    await supabaseClient.from("agent_conversations").insert({
      telegram_chat_id: chatId,
      anthropic_session_id: anthropicSessionId,
      is_active: true
    });
  }
  const messageId = await sendMessage(chatId, escapeMd("⏳ Thinking…"));
  const finalText = await runPrompt(apiKey, anthropicSessionId, text, async (full) => {
    await editMessage(chatId, messageId, escapeMd(full));
  });
  await editMessage(chatId, messageId, escapeMd(finalText || "(no response)"));
}
__name(handleAgentProxyChat, "handleAgentProxyChat");

export {
  handleAgentProxyChat
};
//# sourceMappingURL=chunk-HS6Z3CFP.mjs.map
