import { supabaseClient, type UserSession } from "../lib/supabase";
import { sendMessage, editMessage, escapeMd } from "../lib/telegram";
import { decryptApiKey } from "../lib/crypto";
import { createSession, runPrompt } from "../lib/anthropic";
import type { TelegramEventPayload } from "./router";

export async function handleAgentProxyChat(
  session: UserSession,
  payload: TelegramEventPayload
): Promise<void> {
  const { chatId, text } = payload;

  // Reset conversation thread
  if (text.trim() === "/new_chat") {
    await supabaseClient
      .from("agent_conversations")
      .update({ is_active: false })
      .eq("telegram_chat_id", chatId)
      .eq("is_active", true);

    await sendMessage(chatId, escapeMd("🔄 Context cleared. A fresh conversation session has been initialized with your Chief of Staff."));
    return;
  }

  if (!text.trim()) return;

  const apiKey = await decryptApiKey(session.encrypted_anthropic_key!);

  // Resolve or create an active Anthropic session
  const { data: activeConv } = await supabaseClient
    .from("agent_conversations")
    .select("anthropic_session_id")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  let anthropicSessionId = activeConv?.anthropic_session_id as string | undefined;

  if (!anthropicSessionId) {
    anthropicSessionId = await createSession(apiKey, {
      agentId: session.anthropic_agent_id!,
      environmentId: session.anthropic_environment_id!,
      vaultId: session.anthropic_vault_id,
      fileIds: session.anthropic_file_ids,
    });

    await supabaseClient.from("agent_conversations").insert({
      telegram_chat_id: chatId,
      anthropic_session_id: anthropicSessionId,
      is_active: true,
    });
  }

  // Placeholder bubble, updated live as the agent streams.
  const messageId = await sendMessage(chatId, escapeMd("⏳ Thinking…"));

  const finalText = await runPrompt(apiKey, anthropicSessionId, text, async (full) => {
    await editMessage(chatId, messageId, escapeMd(full));
  });

  await editMessage(chatId, messageId, escapeMd(finalText || "(no response)"));
}
