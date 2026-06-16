import {
  __name,
  init_esm
} from "./chunk-6ZPQH2JT.mjs";

// lib/crypto.ts
init_esm();
var ALGORITHM = "AES-GCM";
var KEY_LENGTH = 256;
var IV_LENGTH = 12;
function getKeyMaterial() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}
__name(getKeyMaterial, "getKeyMaterial");
async function encryptApiKey(plaintext) {
  const keyMaterial = getKeyMaterial();
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);
  const ivB64 = Buffer.from(iv).toString("base64");
  const ctB64 = Buffer.from(ciphertext).toString("base64");
  return `${ivB64}:${ctB64}`;
}
__name(encryptApiKey, "encryptApiKey");
async function decryptApiKey(encrypted) {
  const [ivB64, ctB64] = encrypted.split(":");
  if (!ivB64 || !ctB64) throw new Error("Invalid encrypted payload format");
  const keyMaterial = getKeyMaterial();
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["decrypt"]
  );
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
__name(decryptApiKey, "decryptApiKey");

export {
  encryptApiKey,
  decryptApiKey
};
//# sourceMappingURL=chunk-PJL4ULKY.mjs.map
