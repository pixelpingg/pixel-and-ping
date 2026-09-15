import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { failoverSettings, failoverEvents, endpoints } from "../db/schema";
import { newId } from "../lib/crypto";
import { evaluateFailoverForAllServers } from "../services/failoverService";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { badRequest } from "../lib/response";
import type { Env } from "../lib/env";

export const failoverRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
failoverRoutes.use("*", requireAuth);

failoverRoutes.get("/settings", async (c) => {
  const db = getDb(c.env);
  let settings = await db.select().from(failoverSettings).limit(1).get();
  if (!settings) {
    const row = { id: newId(), enabled: false, failureThreshold: 3, retryCount: 2, healthCheckIntervalSec: 30, recoveryThreshold: 2, strategy: "HEALTH_BASED", updatedAt: new Date() };
    await db.insert(failoverSettings).values(row);
    settings = row as any;
  }
  return c.json({ settings });
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  failureThreshold: z.number().int().min(1).max(20).optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
  healthCheckIntervalSec: z.number().int().min(5).max(3600).optional(),
  recoveryThreshold: z.number().int().min(1).max(20).optional(),
  strategy: z.enum(["ROUND_ROBIN", "LEAST_LATENCY", "WEIGHTED", "HEALTH_BASED"]).optional(),
});

failoverRoutes.patch("/settings", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid settings");

  const db = getDb(c.env);
  let existing = await db.select().from(failoverSettings).limit(1).get();
  if (!existing) {
    const row = { id: newId(), enabled: false, failureThreshold: 3, retryCount: 2, healthCheckIntervalSec: 30, recoveryThreshold: 2, strategy: "HEALTH_BASED", updatedAt: new Date(), ...parsed.data };
    await db.insert(failoverSettings).values(row);
    existing = row as any;
  } else {
    await db.update(failoverSettings).set({ ...parsed.data, updatedAt: new Date() }).where(eq(failoverSettings.id, existing.id));
  }
  await logActivity(c.env, { adminId: auth.adminId, action: "failover.settings.update", metadata: parsed.data });
  const settings = await db.select().from(failoverSettings).limit(1).get();
  return c.json({ settings });
});

failoverRoutes.get("/events", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(failoverEvents).limit(50).all();
  rows.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());

  const enriched = await Promise.all(
    rows.map(async (e) => {
      const from = e.fromEndpointId ? await db.select().from(endpoints).where(eq(endpoints.id, e.fromEndpointId)).get() : null;
      const to = e.toEndpointId ? await db.select().from(endpoints).where(eq(endpoints.id, e.toEndpointId)).get() : null;
      return { ...e, fromEndpoint: from, toEndpoint: to };
    })
  );
  return c.json({ events: enriched });
});

failoverRoutes.post("/evaluate", requireRole("ADMIN"), async (c) => {
  const results = await evaluateFailoverForAllServers(c.env);
  return c.json({ results });
});
