function baseUrl(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN env var is not set");
  return `https://api.telegram.org/bot${token}`;
}

export async function sendMessage(chatId: number, text: string, extra?: object): Promise<number> {
  const url = `${baseUrl()}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2", ...extra });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err: any) {
    throw new Error(`Telegram sendMessage network failure: ${err?.message} | cause: ${JSON.stringify(err?.cause)}`);
  }

  const data = await res.json() as any;
  if (!data.ok) throw new Error(`Telegram sendMessage error: ${JSON.stringify(data)}`);
  return data.result.message_id as number;
}

export async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "MarkdownV2" }),
  });
  const data = await res.json() as any;
  if (!data.ok) throw new Error(`Telegram editMessage error: ${JSON.stringify(data)}`);
}

export async function getFileUrl(fileId: string): Promise<string> {
  const res = await fetch(`${baseUrl()}/getFile?file_id=${fileId}`);
  const data = await res.json() as any;
  const filePath = data.result.file_path as string;
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

export function escapeMd(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export type InlineButton = { text: string; callback_data: string };

// Sends a message with an inline keyboard. `rows` is an array of button rows.
export async function sendKeyboard(
  chatId: number,
  text: string,
  rows: InlineButton[][],
): Promise<number> {
  const res = await fetch(`${baseUrl()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: rows },
    }),
  });
  const data = (await res.json()) as any;
  if (!data.ok) throw new Error(`Telegram sendKeyboard error: ${JSON.stringify(data)}`);
  return data.result.message_id as number;
}

// Acknowledges a button tap so Telegram stops showing the loading spinner.
export async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`${baseUrl()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
  });
}
