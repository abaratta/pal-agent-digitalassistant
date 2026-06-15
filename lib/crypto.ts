const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV for AES-GCM

function getKeyMaterial(): Buffer {
  const hex = process.env.ENCRYPTION_KEY!;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export async function encryptApiKey(plaintext: string): Promise<string> {
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

  // Store as iv:ciphertext (both base64)
  const ivB64 = Buffer.from(iv).toString("base64");
  const ctB64 = Buffer.from(ciphertext).toString("base64");
  return `${ivB64}:${ctB64}`;
}

export async function decryptApiKey(encrypted: string): Promise<string> {
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
