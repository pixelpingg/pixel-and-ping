import bcrypt from "bcryptjs";

// Same pp_live_<hex> shape as the Node backend's lib/apiKey.ts, so
// existing/documented ingestion keys and README examples stay valid.
export function generateApiKey(): { plaintext: string; prefix: string } {
  const raw = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const plaintext = `pp_live_${raw.slice(0, 48)}`;
  const prefix = plaintext.slice(0, 16);
  return { plaintext, prefix };
}

export async function hashApiKey(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 10);
}

export async function verifyApiKey(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
