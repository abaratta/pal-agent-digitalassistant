import {
  escapeMd,
  getFileUrl,
  sendMessage,
  supabaseClient
} from "./chunk-VO6BGZX2.mjs";
import {
  encryptApiKey
} from "./chunk-PJL4ULKY.mjs";
import {
  __name,
  init_esm
} from "./chunk-6ZPQH2JT.mjs";

// trigger/onboarding.ts
init_esm();
var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function handleOnboardingStep(session, payload) {
  const { chatId, text, document } = payload;
  const step = session.current_step;
  switch (step) {
    case "collect_name": {
      if (!text.trim()) {
        await sendMessage(chatId, escapeMd("Welcome! Please enter your full name to begin provisioning your Chief of Staff assistant:"));
        return;
      }
      await updateSession(chatId, { user_name: text.trim(), current_step: "collect_email" });
      await sendMessage(chatId, escapeMd(`Thank you, ${text.trim()}! What is your preferred business email address?`));
      break;
    }
    case "collect_email": {
      if (!EMAIL_REGEX.test(text.trim())) {
        await sendMessage(chatId, escapeMd("That doesn't look like a valid email. Please enter your business email address:"));
        return;
      }
      await updateSession(chatId, { email: text.trim(), current_step: "collect_company" });
      await sendMessage(chatId, escapeMd("Please enter the legal or operational name of your organization/company:"));
      break;
    }
    case "collect_company": {
      if (!text.trim()) return;
      await updateSession(chatId, { company: text.trim(), current_step: "collect_website" });
      await sendMessage(chatId, escapeMd("What is your main company website URL?"));
      break;
    }
    case "collect_website": {
      if (!text.trim()) return;
      await updateSession(chatId, { website: text.trim(), current_step: "collect_anthropic_key" });
      await sendMessage(
        chatId,
        escapeMd(
          "Provide your secret Anthropic Developer API Key. This will be encrypted at rest in your secure agent profile workspace:"
        )
      );
      break;
    }
    case "collect_anthropic_key": {
      if (!text.trim().startsWith("sk-ant-")) {
        await sendMessage(chatId, escapeMd("That doesn't look like a valid Anthropic API key. It should start with sk-ant-. Please try again:"));
        return;
      }
      const encryptedKey = await encryptApiKey(text.trim());
      await updateSession(chatId, { encrypted_anthropic_key: encryptedKey, current_step: "upload_knowledge_base" });
      await sendMessage(
        chatId,
        escapeMd(
          "✅ API key encrypted and stored securely!\n\nPlease attach and upload your business knowledge documents (PDF, MD, TXT). Use the paperclip icon. Send /skip to proceed without documents."
        )
      );
      break;
    }
    case "upload_knowledge_base": {
      if (text.trim() === "/skip") {
        await updateSession(chatId, { current_step: "configure_mcp" });
        await sendMcpInstructions(chatId);
        return;
      }
      if (!document) {
        await sendMessage(chatId, escapeMd("Please attach a file (PDF, MD, or TXT) or send /skip to continue."));
        return;
      }
      await uploadDocumentToAnthropic(session, document);
      await sendMessage(chatId, escapeMd("📎 Document uploaded to your agent's knowledge base! Send another file or /skip to continue."));
      break;
    }
    case "configure_mcp": {
      if (text.trim() === "/setup_complete") {
        await updateSession(chatId, { onboarding_completed: true, current_step: "operational" });
        await sendMessage(chatId, escapeMd("🎉 Your Chief of Staff is ready! Send me a message to get started."));
        return;
      }
      await sendMcpInstructions(chatId);
      break;
    }
  }
}
__name(handleOnboardingStep, "handleOnboardingStep");
async function updateSession(chatId, fields) {
  await supabaseClient.from("user_sessions").update({ ...fields, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("telegram_chat_id", chatId);
}
__name(updateSession, "updateSession");
async function uploadDocumentToAnthropic(session, document) {
  const { decryptApiKey } = await import("./crypto-WYAW6MPJ.mjs");
  const apiKey = await decryptApiKey(session.encrypted_anthropic_key);
  const fileUrl = await getFileUrl(document.file_id);
  const fileRes = await fetch(fileUrl);
  const fileBuffer = await fileRes.arrayBuffer();
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: document.mime_type }), document.file_name);
  const uploadRes = await fetch("https://api.anthropic.com/v1/files", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14"
    },
    body: formData
  });
  const uploadedFile = await uploadRes.json();
  if (session.anthropic_agent_id) {
    await fetch(`https://api.anthropic.com/v1/agents/${session.anthropic_agent_id}`, {
      method: "PATCH",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "managed-agents-2026-04-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ file_ids: [uploadedFile.id] })
    });
  }
}
__name(uploadDocumentToAnthropic, "uploadDocumentToAnthropic");
async function sendMcpInstructions(chatId) {
  const msg = `🤖 *Step 6: Provisioning & Authorizing your MCP Connectors*

Your personal digital Chief of Staff is initialized\\! To enable enterprise tool integration \\(Email engines, Calendars, Social media accounts\\), you must authorize the connector infrastructure directly within your Anthropic developer space\\.

*Instructions:*
1️⃣ Access your secure Anthropic Developer Console\\.
2️⃣ Click on *Agent Profiles* and choose your active Assistant ID\\.
3️⃣ Navigate to *MCP Connected Server Vaults*, select your desired app, and enter your account login profiles\\.

When done, send /setup\\_complete to activate your assistant\\.`;
  await sendMessage(chatId, msg);
}
__name(sendMcpInstructions, "sendMcpInstructions");

export {
  handleOnboardingStep
};
//# sourceMappingURL=chunk-5AWLRPTF.mjs.map
