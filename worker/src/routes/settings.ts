import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { settings } from "../db/schema";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import type { Env } from "../lib/env";

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
settingsRoutes.use("*", requireAuth);

settingsRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(settings).all();
  const map: Record<string, unknown> = {};
  for (const s of rows) map[s.key] = JSON.parse(s.value);
  return c.json({ settings: map });
});

const upsertSchema = z.object({ value: z.any() });

settingsRoutes.put("/:key", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const key = c.req.param("key")!;
  const body = await c.req.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid value" } }, 400);

  const db = getDb(c.env);
  const existing = await db.select().from(settings).where(eq(settings.key, key)).get();
  if (existing) {
    await db.update(settings).set({ value: JSON.stringify(parsed.data.value), updatedAt: new Date() }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ id: newId(), key, value: JSON.stringify(parsed.data.value), updatedAt: new Date() });
  }
  await logActivity(c.env, { adminId: auth.adminId, action: "settings.update", metadata: { key } });
  const setting = await db.select().from(settings).where(eq(settings.key, key)).get();
  return c.json({ setting: setting ? { ...setting, value: JSON.parse(setting.value) } : null });
});
