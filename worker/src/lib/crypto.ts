// AES-256-GCM encryption using the Web Crypto API (SubtleCrypto) — this
// runs natively in the Workers runtime, unlike Node's `crypto` module.
// Used to encrypt Cloudflare API tokens at rest in D1, exactly as
// backend/src/lib/crypto.ts does for the Postgres version, just with a
// Workers-native primitive instead of Node's.

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64 (SubtleCrypto appends the GCM tag to the ciphertext; split out for storage parity with the Postgres schema's 3-column layout)
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (base64). Generate with: openssl rand -base64 32");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, encryptionKeyB64: string): Promise<EncryptedPayload> {
  const key = await importKey(encryptionKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  // WebCrypto's AES-GCM output is ciphertext || 16-byte tag concatenated.
  // Split it so the storage shape matches the Postgres version's separate
  // ciphertext/authTag columns.
  const full = new Uint8Array(cipherBuf);
  const ciphertext = full.slice(0, full.length - 16);
  const authTag = full.slice(full.length - 16);

  return {
    ciphertext: toBase64(ciphertext.buffer),
    iv: toBase64(iv.buffer),
    authTag: toBase64(authTag.buffer),
  };
}

export async function decryptSecret(payload: EncryptedPayload, encryptionKeyB64: string): Promise<string> {
  const key = await importKey(encryptionKeyB64);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const authTag = fromBase64(payload.authTag);

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);

  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
  return new TextDecoder().decode(plainBuf);
}

// Never log full tokens.
export function redactToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}

export function newId(): string {
  // crypto.randomUUID() is available natively in the Workers runtime.
  return crypto.randomUUID();
}
