import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { endpoints, servers } from "../db/schema";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { checkEndpointHealth } from "../services/healthCheckService";
import { badRequest } from "../lib/response";
import { sanitizeHost } from "../lib/host";
import type { Env } from "../lib/env";

export const endpointsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
endpointsRoutes.use("*", requireAuth);

const endpointSchema = z.object({
  serverId: z.string().min(1),
  label: z.string().min(1),
  host: z.string().min(1).transform(sanitizeHost),
  port: z.number().int().min(1).max(65535),
  weight: z.number().int().min(0).max(1000).default(100),
  isPrimary: z.boolean().default(false),
});

endpointsRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const serverId = c.req.query("serverId");
  const sortBy = c.req.query("sortBy") ?? "score";
  const order = c.req.query("order") ?? "desc";

  const rows = serverId ? await db.select().from(endpoints).where(eq(endpoints.serverId, serverId)).all() : await db.select().from(endpoints).all();
  rows.sort((a: any, b: any) => (order === "asc" ? a[sortBy] - b[sortBy] : b[sortBy] - a[sortBy]));

  const enriched = await Promise.all(
    rows.map(async (e) => {
      const server = await db.select().from(servers).where(eq(servers.id, e.serverId)).get();
      return { ...e, server: server ? { id: server.id, name: server.name } : null };
    })
  );
  return c.json({ endpoints: enriched });
});

endpointsRoutes.post("/", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = endpointSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid endpoint data");
  const db = getDb(c.env);

  // Ownership guardrail: endpoints may only belong to a server already
  // registered in this operator's own inventory.
  const server = await db.select().from(servers).where(eq(servers.id, parsed.data.serverId)).get();
  if (!server) return badRequest(c, "Endpoint must belong to a server already registered in your inventory");

  const id = newId();
  const now = new Date();
  await db.insert(endpoints).values({ id, ...parsed.data, createdAt: now, updatedAt: now });
  await logActivity(c.env, { adminId: auth.adminId, action: "endpoint.create", targetType: "Endpoint", targetId: id });
  const endpoint = await db.select().from(endpoints).where(eq(endpoints.id, id)).get();
  return c.json({ endpoint }, 201);
});

endpointsRoutes.delete("/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  await db.delete(endpoints).where(eq(endpoints.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "endpoint.delete", targetType: "Endpoint", targetId: id });
  return c.body(null, 204);
});

endpointsRoutes.post("/:id/scan", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const endpoint = await checkEndpointHealth(c.env, id);
  await logActivity(c.env, { adminId: auth.adminId, action: "endpoint.scan", targetType: "Endpoint", targetId: id });
  return c.json({ endpoint });
});

endpointsRoutes.post("/scan-all", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const serverId = body?.serverId as string | undefined;
  const db = getDb(c.env);
  const rows = serverId ? await db.select().from(endpoints).where(eq(endpoints.serverId, serverId)).all() : await db.select().from(endpoints).all();
  const results = [];
  for (const ep of rows) results.push(await checkEndpointHealth(c.env, ep.id));
  return c.json({ results });
});
