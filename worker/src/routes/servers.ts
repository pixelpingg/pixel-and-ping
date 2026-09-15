import { Hono } from "hono";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { getDb } from "../lib/db";
import { servers, endpoints, vpnUsers, cloudflareAccounts } from "../db/schema";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { checkEndpointHealth } from "../services/healthCheckService";
import { createNotification } from "../services/notificationService";
import { badRequest, notFound } from "../lib/response";
import { sanitizeHost } from "../lib/host";
import { isSelfServerId } from "../services/selfServerService";
import type { Env } from "../lib/env";

export const serversRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
serversRoutes.use("*", requireAuth);

const serverSchema = z.object({
  name: z.string().min(2),
  host: z.string().min(1).transform(sanitizeHost),
  port: z.number().int().min(1).max(65535),
  protocol: z.string().min(2),
  location: z.string().optional(),
  cloudflareAccountId: z.string().optional(),
});

serversRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(servers).all();
  const enriched = await Promise.all(
    rows.map(async (s) => {
      const [{ userCount }] = await db.select({ userCount: count() }).from(vpnUsers).where(eq(vpnUsers.serverId, s.id)).all();
      const [{ endpointCount }] = await db.select({ endpointCount: count() }).from(endpoints).where(eq(endpoints.serverId, s.id)).all();
      return { ...s, _count: { users: userCount, endpoints: endpointCount } };
    })
  );
  return c.json({ servers: enriched });
});

serversRoutes.get("/:id", async (c) => {
  const db = getDb(c.env);
  const server = await db.select().from(servers).where(eq(servers.id, c.req.param("id")!)).get();
  if (!server) return notFound(c, "Server not found");
  const serverEndpoints = await db.select().from(endpoints).where(eq(endpoints.serverId, server.id)).all();
  let cfAccount = null;
  if (server.cloudflareAccountId) {
    const acc = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, server.cloudflareAccountId)).get();
    cfAccount = acc ? { id: acc.id, name: acc.name } : null;
  }
  return c.json({ server: { ...server, endpoints: serverEndpoints, cloudflareAccount: cfAccount } });
});

serversRoutes.post("/", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = serverSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid server data");
  const db = getDb(c.env);
  const id = newId();
  const now = new Date();
  await db.insert(servers).values({ id, ...parsed.data, location: parsed.data.location ?? null, cloudflareAccountId: parsed.data.cloudflareAccountId ?? null, createdAt: now, updatedAt: now });
  await logActivity(c.env, { adminId: auth.adminId, action: "server.create", targetType: "Server", targetId: id });
  const server = await db.select().from(servers).where(eq(servers.id, id)).get();
  return c.json({ server }, 201);
});

serversRoutes.patch("/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const body = await c.req.json();
  const parsed = serverSchema.partial().safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid server data");
  const db = getDb(c.env);
  await db.update(servers).set({ ...parsed.data, updatedAt: new Date() }).where(eq(servers.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "server.update", targetType: "Server", targetId: id });
  const server = await db.select().from(servers).where(eq(servers.id, id)).get();
  return c.json({ server });
});

serversRoutes.post("/:id/toggle", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  const server = await db.select().from(servers).where(eq(servers.id, id)).get();
  if (!server) return notFound(c, "Server not found");
  await db.update(servers).set({ isEnabled: !server.isEnabled, updatedAt: new Date() }).where(eq(servers.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "server.toggle", targetType: "Server", targetId: id });
  const updated = await db.select().from(servers).where(eq(servers.id, id)).get();
  return c.json({ server: updated });
});

serversRoutes.delete("/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  // The auto-provisioned self server (this Worker's own domain — see
  // services/selfServerService.ts) is re-created on the very next
  // request anyway, so deleting it here would just leave orphaned users/
  // configs until then. Block it with a clear message instead.
  if (isSelfServerId(id)) return badRequest(c, "This server is this Worker's own auto-provisioned node and can't be deleted. Disable it instead.");
  const db = getDb(c.env);
  await db.delete(servers).where(eq(servers.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "server.delete", targetType: "Server", targetId: id });
  return c.body(null, 204);
});

serversRoutes.post("/:id/health-check", async (c) => {
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  const serverEndpoints = await db.select().from(endpoints).where(eq(endpoints.serverId, id)).all();
  if (serverEndpoints.length === 0) return badRequest(c, "This server has no endpoints configured to health-check");

  const results = [];
  for (const ep of serverEndpoints) results.push(await checkEndpointHealth(c.env, ep.id));

  const anyHealthy = results.some((r) => r.health !== "OFFLINE");
  const server = await db.select().from(servers).where(eq(servers.id, id)).get();
  const newStatus = anyHealthy ? "ONLINE" : "OFFLINE";

  if (server && server.status !== "OFFLINE" && newStatus === "OFFLINE") {
    await createNotification(c.env, { level: "ERROR", title: "Server offline", message: `${server.name} has no healthy endpoints.` });
  }
  await db.update(servers).set({ status: newStatus, updatedAt: new Date() }).where(eq(servers.id, id));

  return c.json({ results });
});
