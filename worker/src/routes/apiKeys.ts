import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { apiKeys } from "../db/schema";
import { generateApiKey, hashApiKey } from "../lib/apiKey";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { badRequest } from "../lib/response";
import type { Env } from "../lib/env";

export const apiKeysRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
apiKeysRoutes.use("*", requireAuth, requireRole("ADMIN"));

function toPublic(k: typeof apiKeys.$inferSelect) {
  const { keyHash, ...safe } = k;
  return { ...safe, scopes: JSON.parse(k.scopes) };
}

apiKeysRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(apiKeys).all();
  return c.json({ keys: rows.map(toPublic) });
});

const createSchema = z.object({ name: z.string().min(2).max(64), scopes: z.array(z.enum(["TRAFFIC_INGEST", "PRESENCE_INGEST", "FULL_INGEST"])).min(1) });

apiKeysRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid API key data");

  const { plaintext, prefix } = generateApiKey();
  const keyHash = await hashApiKey(plaintext);

  const id = newId();
  const db = getDb(c.env);
  await db.insert(apiKeys).values({
    id,
    name: parsed.data.name,
    keyPrefix: prefix,
    keyHash,
    scopes: JSON.stringify(parsed.data.scopes),
    isActive: true,
    createdById: auth.adminId,
    createdAt: new Date(),
  });
  await logActivity(c.env, { adminId: auth.adminId, action: "apikey.create", targetType: "ApiKey", targetId: id });

  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  // The only moment the plaintext key exists outside this function — never
  // logged, never retrievable again.
  return c.json({ key: toPublic(key!), plaintextKey: plaintext }, 201);
});

apiKeysRoutes.post("/:id/revoke", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const db = getDb(c.env);
  await db.update(apiKeys).set({ isActive: false, revokedAt: new Date() }).where(eq(apiKeys.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "apikey.revoke", targetType: "ApiKey", targetId: id });
  const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  return c.json({ key: key ? toPublic(key) : null });
});

apiKeysRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const db = getDb(c.env);
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "apikey.delete", targetType: "ApiKey", targetId: id });
  return c.body(null, 204);
});
