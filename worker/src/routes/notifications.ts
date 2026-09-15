import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { notifications } from "../db/schema";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { badRequest } from "../lib/response";
import { logActivity } from "../services/activityLogService";
import type { Env } from "../lib/env";

export const notificationsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
notificationsRoutes.use("*", requireAuth);

notificationsRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const unreadOnly = c.req.query("unreadOnly") === "true";
  const rows = unreadOnly ? await db.select().from(notifications).where(eq(notifications.isRead, false)).all() : await db.select().from(notifications).all();
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return c.json({ notifications: rows.slice(0, 50) });
});

// Every admin logged into this panel shares one read/unread state per
// notification (see db/schema.ts — there's no per-admin read table),
// which is fine for system alerts and is the same model this broadcast
// feature uses: one message, matching read state for everyone who can
// see the panel, same as any other notification here.
const broadcastSchema = z.object({
  level: z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]).default("INFO"),
  // Keyed by UI locale code (en/fa/ru/zh) — at least one required. A
  // recipient whose own UI language isn't included falls back to
  // whichever locale was provided first (see frontend's NotificationBell).
  titles: z.record(z.string().min(1)).refine((v) => Object.keys(v).length > 0, "At least one locale required"),
  messages: z.record(z.string().min(1)).refine((v) => Object.keys(v).length > 0, "At least one locale required"),
});

notificationsRoutes.post("/broadcast", requireRole("SUPER_ADMIN"), async (c) => {
  const auth = c.get("auth");
  const parsed = broadcastSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Invalid broadcast payload");
  const { level, titles, messages } = parsed.data;
  const firstLocale = Object.keys(titles)[0];

  const db = getDb(c.env);
  const row = {
    id: newId(),
    level,
    title: titles[firstLocale],
    message: messages[firstLocale],
    isRead: false,
    metadata: JSON.stringify({ broadcast: true, titles, messages }),
    createdAt: new Date(),
  };
  await db.insert(notifications).values(row);
  await logActivity(c.env, { adminId: auth.adminId, action: "notifications.broadcast", targetType: "Notification", targetId: row.id });
  return c.json({ notification: row }, 201);
});

notificationsRoutes.post("/:id/read", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
  const notification = await db.select().from(notifications).where(eq(notifications.id, id)).get();
  return c.json({ notification });
});

notificationsRoutes.post("/read-all", async (c) => {
  const db = getDb(c.env);
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.isRead, false));
  return c.json({ ok: true });
});
