import { Hono } from "hono";
import { eq, like, count } from "drizzle-orm";
import { getDb } from "../lib/db";
import { activityLogs, admins } from "../db/schema";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import type { Env } from "../lib/env";

export const logsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
logsRoutes.use("*", requireAuth, requireRole("ADMIN"));

logsRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 30)));
  const action = c.req.query("action");

  const where = action ? like(activityLogs.action, `%${action}%`) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(activityLogs).where(where).all();
  const rows = await db.select().from(activityLogs).where(where).limit(pageSize).offset((page - 1) * pageSize).all();
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const enriched = await Promise.all(
    rows.map(async (l) => {
      const admin = l.adminId ? await db.select().from(admins).where(eq(admins.id, l.adminId)).get() : null;
      return { ...l, admin: admin ? { username: admin.username, email: admin.email } : null };
    })
  );

  return c.json({ logs: enriched, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});
