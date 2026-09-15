import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { endpoints, servers, healthChecks } from "../db/schema";
import { checkAllEndpoints } from "../services/healthCheckService";
import { requireAuth, type AuthPayload } from "../middleware/auth";
import type { Env } from "../lib/env";

export const healthRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
healthRoutes.use("*", requireAuth);

healthRoutes.get("/endpoints", async (c) => {
  const db = getDb(c.env);
  const health = c.req.query("health");
  const rows = health ? await db.select().from(endpoints).where(eq(endpoints.health, health)).all() : await db.select().from(endpoints).all();
  rows.sort((a, b) => b.score - a.score);

  const enriched = await Promise.all(
    rows.map(async (e) => {
      const server = await db.select().from(servers).where(eq(servers.id, e.serverId)).get();
      return { ...e, server: server ? { id: server.id, name: server.name } : null };
    })
  );
  return c.json({ endpoints: enriched });
});

healthRoutes.post("/scan-all", async (c) => {
  const results = await checkAllEndpoints(c.env);
  return c.json({ results });
});

healthRoutes.get("/history/:endpointId", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(healthChecks).where(eq(healthChecks.endpointId, c.req.param("endpointId"))).limit(50).all();
  return c.json({ history: rows });
});
