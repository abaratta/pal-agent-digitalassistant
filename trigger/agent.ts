import Anthropic from "@anthropic-ai/sdk";
import { supabaseClient, type UserSession } from "../lib/supabase";
import { sendMessage, editMessage, escapeMd } from "../lib/telegram";
import { decryptApiKey } from "../lib/crypto";
import type { TelegramEventPayload } from "./router";

const STREAM_THROTTLE_MS = 1200;

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

  // Resolve or create an active Anthropic session
  let { data: activeConv } = await supabaseClient
    .from("agent_conversations")
    .select("anthropic_session_id")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  const apiKey = await decryptApiKey(session.encrypted_anthropic_key!);
  const anthropic = new Anthropic({ apiKey });

  let anthropicSessionId = activeConv?.anthropic_session_id;

  if (!anthropicSessionId) {
    const newSession = await (anthropic.beta as any).agents.sessions.create({
      agent_id: session.anthropic_agent_id,
    }, {
      headers: { "anthropic-beta": "managed-agents-2026-04-01" },
    });

    anthropicSessionId = newSession.id;

    await supabaseClient.from("agent_conversations").insert({
      telegram_chat_id: chatId,
      anthropic_session_id: anthropicSessionId,
      is_active: true,
    });
  }

  // Send a placeholder bubble while streaming
  let telegramMessageId = await sendMessage(chatId, escapeMd("⏳ Thinking…"));
  let buffer = "";
  let lastEditAt = 0;

  const stream = await (anthropic.beta as any).agents.sessions.messages.create(
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

  // Final flush — ensure the complete response is shown
  if (buffer) {
    await editMessage(chatId, telegramMessageId, escapeMd(buffer));
  }
}
