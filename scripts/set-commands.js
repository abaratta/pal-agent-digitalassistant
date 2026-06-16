// Registers the bot command list with Telegram so users see it when they type /.
// Run once after any command changes: node scripts/set-commands.js
//
// Requires TELEGRAM_BOT_TOKEN in .env (or already in the shell environment).

require("dotenv").config();

// Force IPv4 — same fix as lib/netfix.ts (IPv6 to Telegram is broken on this network)
const { Agent, setGlobalDispatcher } = require("undici");
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not set.");
  process.exit(1);
}

const COMMANDS = [
  { command: "newchat", description: "Start a fresh conversation (clears context, keeps memories)" },
  { command: "help",     description: "Show available commands" },
];

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands: COMMANDS }),
  });

  const data = await res.json();
  if (data.ok) {
    console.log("✅ Bot commands registered:");
    COMMANDS.forEach((c) => console.log(`  /${c.command} — ${c.description}`));
  } else {
    console.error("❌ Failed:", JSON.stringify(data));
    process.exit(1);
  }
}

main();
