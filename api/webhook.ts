import { tasks } from "@trigger.dev/sdk/v3";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Authenticate the webhook: Telegram echoes the secret_token we registered via
  // setWebhook in this header. Without this check, anyone who discovers the URL
  // could POST a forged update with an arbitrary chat.id and drive another user's
  // agent. The secret must be configured; we fail closed if it isn't.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set — rejecting webhook");
    return res.status(500).send("Server misconfigured");
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== expectedSecret) {
    return res.status(401).send("Unauthorized");
  }

  const payload = req.body;
  const updateId: number = payload?.update_id;

  // Button tap (connector selection during onboarding)
  if (payload?.callback_query) {
    const cb = payload.callback_query;
    await tasks.trigger("route-telegram-event", {
      chatId: cb.message.chat.id,
      text: "",
      document: null,
      updateId,
      callback: { id: cb.id, data: cb.data ?? "" },
    });
    return res.status(200).json({ ok: true });
  }

  if (!payload?.message) return res.status(200).send("OK");

  const chatId: number = payload.message.chat.id;
  const text: string = payload.message.text ?? "";
  const document = payload.message.document ?? null;

  await tasks.trigger("route-telegram-event", {
    chatId,
    text,
    document,
    updateId,
    callback: null,
  });

  return res.status(200).json({ ok: true });
}
