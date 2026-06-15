import { task } from "@trigger.dev/sdk/v3";
import { supabaseClient, type UserSession } from "../lib/supabase";
import { handleOnboardingStep } from "./onboarding";
import { handleAgentProxyChat } from "./agent";

export type TelegramEventPayload = {
  chatId: number;
  text: string;
  document: { file_id: string; file_name: string; mime_type: string } | null;
  updateId: number;
};

export const routeTelegramEvent = task({
  id: "route-telegram-event",
  run: async (payload: TelegramEventPayload) => {
    // Idempotency: skip if this update_id was already processed
    const { data: seen } = await supabaseClient
      .from("processed_updates")
      .select("update_id")
      .eq("update_id", payload.updateId)
      .maybeSingle();

    if (seen) return { skipped: true };

    await supabaseClient
      .from("processed_updates")
      .insert({ update_id: payload.updateId });

    // Load or create the user session
    let { data: session } = await supabaseClient
      .from("user_sessions")
      .select("*")
      .eq("telegram_chat_id", payload.chatId)
      .maybeSingle();

    if (!session) {
      const { data: newSession } = await supabaseClient
        .from("user_sessions")
        .insert({ telegram_chat_id: payload.chatId })
        .select()
        .single();
      session = newSession;
    }

    if (!session) throw new Error(`Could not create session for chat ${payload.chatId}`);

    if (!session.onboarding_completed) {
      return await handleOnboardingStep(session as UserSession, payload);
    } else {
      return await handleAgentProxyChat(session as UserSession, payload);
    }
  },
});
