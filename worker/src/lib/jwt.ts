// Minimal HS256 JWT implementation using Web Crypto — avoids depending on
// Node's `jsonwebtoken` package, which is unnecessary weight for a single
// HMAC algorithm and not guaranteed compatible with every Workers runtime
// configuration. This does exactly what backend/src/routes/auth.ts's
// `jwt.sign`/`jwt.verify` did, no more.

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds: number): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64url(sig)}`;
}

export async function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): Promise<T> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, base64urlDecode(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  if (!valid) throw new Error("Invalid token signature");

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as T & { exp?: number };
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload;
}
