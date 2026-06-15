const BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function sendMessage(chatId: number, text: string, extra?: object): Promise<number> {
  const res = await fetch(`${BASE_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2", ...extra }),
  });
  const data = await res.json() as any;
  return data.result.message_id as number;
}

export async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  await fetch(`${BASE_URL}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "MarkdownV2" }),
  });
}

export async function getFileUrl(fileId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/getFile?file_id=${fileId}`);
  const data = await res.json() as any;
  const filePath = data.result.file_path as string;
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

// Escapes text to comply with Telegram's MarkdownV2 spec
export function escapeMd(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
