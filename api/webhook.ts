import { tasks } from "@trigger.dev/sdk/v3";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const payload = req.body;
  if (!payload?.message) return res.status(200).send("OK");

  const chatId: number = payload.message.chat.id;
  const text: string = payload.message.text ?? "";
  const document = payload.message.document ?? null;
  const updateId: number = payload.update_id;

  await tasks.trigger("route-telegram-event", { chatId, text, document, updateId });

  return res.status(200).json({ ok: true });
}
