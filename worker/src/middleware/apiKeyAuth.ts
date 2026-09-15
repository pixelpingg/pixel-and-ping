import { Context, Next } from "hono";
import { eq, and } from "drizzle-orm";
import { getDb } from "../lib/db";
import { apiKeys } from "../db/schema";
import { verifyApiKey } from "../lib/apiKey";
import type { Env } from "../lib/env";

export interface ApiKeyAuth {
  id: string;
  scopes: string[];
}

/**
 * Same contract as backend/src/middleware/apiKeyAuth.ts — a completely
 * separate credential system from admin sessions, used only by
 * /api/ingest/* for an authorized external VPN daemon/reporter.
 */
export function requireApiKey(...requiredScopes: string[]) {
  return async (c: Context<{ Bindings: Env; Variables: { apiKey: ApiKeyAuth } }>, next: Next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Missing API key. Send 'Authorization: Bearer <key>'." } }, 401);
    }
    const presented = header.slice("Bearer ".length).trim();
    if (!presented.startsWith("pp_live_")) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Malformed API key" } }, 401);
    }

    const prefix = presented.slice(0, 16);
    const db = getDb(c.env);
    const candidates = await db.select().from(apiKeys).where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.isActive, true))).all();

    let matched: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (candidate.revokedAt) continue;
      if (await verifyApiKey(presented, candidate.keyHash)) {
        matched = candidate;
        break;
      }
    }
    if (!matched) return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid or revoked API key" } }, 401);

    const scopes: string[] = JSON.parse(matched.scopes);
    if (requiredScopes.length > 0) {
      const hasScope = scopes.includes("FULL_INGEST") || requiredScopes.some((s) => scopes.includes(s));
      if (!hasScope) return c.json({ error: { code: "FORBIDDEN", message: "This API key does not have the required scope" } }, 403);
    }

    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, matched.id));
    c.set("apiKey", { id: matched.id, scopes });
    await next();
  };
}
