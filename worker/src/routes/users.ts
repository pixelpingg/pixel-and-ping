import { Hono } from "hono";
import { z } from "zod";
import { eq, like, and, desc, count } from "drizzle-orm";
import { sha224 } from "js-sha256";
import { getDb } from "../lib/db";
import { vpnUsers, servers, endpoints } from "../db/schema";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { generateConfiguration, ConfigGenerationError } from "../services/configService";
import { attemptProvisioning, attemptDeprovisioning } from "../services/vpnProvisioningService";
import { ensureAndGetDefaultServerId } from "../services/selfServerService";
import { badRequest, conflict, notFound } from "../lib/response";
import type { Env } from "../lib/env";

export const usersRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
usersRoutes.use("*", requireAuth);

const createUserSchema = z.object({
  username: z.string().min(3).max(64),
  // Optional: omit it and the user is assigned to the auto-provisioned
  // "self" server (this Worker's own domain) — see
  // services/selfServerService.ts. Still overridable for multi-server
  // setups where an admin registered additional real servers.
  serverId: z.string().min(1).optional(),
  preferredEndpointId: z.string().optional(),
  protocol: z.enum(["vless", "trojan"]),
  port: z.number().int().min(1).max(65535),
  // Extra ports beyond `port` — each gets its own config/link generated
  // alongside the primary one (see services/configService.ts).
  extraPorts: z.array(z.number().int().min(1).max(65535)).optional(),
  tls: z.boolean().default(true),
  expiresAt: z.string().datetime().optional(), // omitted/absent = never expires
  // 0 or omitted = unlimited (no cap stored at all).
  trafficLimitGb: z.number().min(0).optional(),
  requestLimit: z.number().int().min(0).optional(),
  autoIpFailover: z.boolean().default(false),
  cloudflareAccountId: z.string().optional(),
  cloudflareZoneId: z.string().optional(),
  hostname: z.string().optional(),
});

usersRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 20)));
  const search = c.req.query("search")?.trim();
  const status = c.req.query("status");

  const conditions = [];
  if (search) conditions.push(like(vpnUsers.username, `%${search}%`));
  if (status) conditions.push(eq(vpnUsers.status, status));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(vpnUsers).where(where).all();
  const rows = await db.select().from(vpnUsers).where(where).orderBy(desc(vpnUsers.createdAt)).limit(pageSize).offset((page - 1) * pageSize).all();

  const enriched = await Promise.all(
    rows.map(async (u) => {
      const server = u.serverId ? await db.select().from(servers).where(eq(servers.id, u.serverId)).get() : null;
      const preferredEndpoint = u.preferredEndpointId ? await db.select().from(endpoints).where(eq(endpoints.id, u.preferredEndpointId)).get() : null;
      return {
        ...u,
        server: server ? { id: server.id, name: server.name } : null,
        preferredEndpoint: preferredEndpoint ? { id: preferredEndpoint.id, label: preferredEndpoint.label, latencyMs: preferredEndpoint.latencyMs, health: preferredEndpoint.health } : null,
      };
    })
  );

  return c.json({ users: enriched, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

usersRoutes.get("/:id", async (c) => {
  const db = getDb(c.env);
  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, c.req.param("id")!)).get();
  if (!user) return notFound(c, "User not found");
  return c.json({ user });
});

usersRoutes.post("/", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid user data");
  const input = parsed.data;

  const db = getDb(c.env);
  const existing = await db.select().from(vpnUsers).where(eq(vpnUsers.username, input.username)).get();
  if (existing) return conflict(c, "A user with this username already exists");

  const serverId = input.serverId ?? (await ensureAndGetDefaultServerId(c.env, c.req.raw));

  const id = newId();
  const now = new Date();
  const uuid = crypto.randomUUID();
  await db.insert(vpnUsers).values({
    id,
    username: input.username,
    serverId,
    preferredEndpointId: input.preferredEndpointId ?? null,
    protocol: input.protocol,
    port: input.port,
    tls: input.tls,
    uuid,
    // Precomputed regardless of protocol so a later PATCH to "trojan"
    // (see updateUserSchema below) doesn't need this backfilled — see
    // db/schema.ts's trojanPasswordHash comment and services/relayService.ts.
    trojanPasswordHash: sha224(uuid),
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    // 0 (or omitted) means unlimited — store no cap at all rather than a
    // literal 0-byte/0-request limit, which would suspend the user
    // immediately on their very first byte/request.
    trafficLimitBytes: input.trafficLimitGb ? Math.round(input.trafficLimitGb * 1e9) : null,
    requestLimit: input.requestLimit ? input.requestLimit : null,
    autoIpFailover: input.autoIpFailover,
    createdAt: now,
    updatedAt: now,
  });

  let generated: Awaited<ReturnType<typeof generateConfiguration>>;
  try {
    generated = await generateConfiguration(c.env, id, {
      cloudflareAccountId: input.cloudflareAccountId,
      cloudflareZoneId: input.cloudflareZoneId,
      hostname: input.hostname,
      ports: input.extraPorts && input.extraPorts.length > 0 ? [input.port, ...input.extraPorts] : undefined,
    });
  } catch (err) {
    // Roll back rather than leave an orphaned user with no configuration.
    await db.delete(vpnUsers).where(eq(vpnUsers.id, id));
    const message = err instanceof ConfigGenerationError ? err.message : "Unable to generate configuration";
    return badRequest(c, message);
  }

  const provisioning = await attemptProvisioning(c.env, id);
  await logActivity(c.env, { adminId: auth.adminId, action: "user.create", targetType: "VpnUser", targetId: id });

  const finalUser = await db.select().from(vpnUsers).where(eq(vpnUsers.id, id)).get();
  return c.json({ user: finalUser, configuration: generated.primary, configurations: generated.all, provisioning }, 201);
});

const updateUserSchema = createUserSchema.partial().extend({ status: z.enum(["ACTIVE", "DISABLED", "SUSPENDED", "EXPIRED"]).optional() });

usersRoutes.patch("/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const body = await c.req.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid update data");
  const input = parsed.data;

  const db = getDb(c.env);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.serverId) patch.serverId = input.serverId;
  if (input.preferredEndpointId !== undefined) patch.preferredEndpointId = input.preferredEndpointId || null;
  if (input.protocol) patch.protocol = input.protocol;
  if (input.port) patch.port = input.port;
  if (input.tls !== undefined) patch.tls = input.tls;
  if (input.status) patch.status = input.status;
  if (input.expiresAt) patch.expiresAt = new Date(input.expiresAt);
  // !== undefined (not truthy-check): an explicit 0 must clear the limit
  // to null (unlimited), which a plain `if (input.trafficLimitGb)` would
  // silently skip, leaving the old cap in place.
  if (input.trafficLimitGb !== undefined) patch.trafficLimitBytes = input.trafficLimitGb > 0 ? Math.round(input.trafficLimitGb * 1e9) : null;
  if (input.requestLimit !== undefined) patch.requestLimit = input.requestLimit > 0 ? input.requestLimit : null;
  if (input.autoIpFailover !== undefined) patch.autoIpFailover = input.autoIpFailover;

  await db.update(vpnUsers).set(patch).where(eq(vpnUsers.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "user.update", targetType: "VpnUser", targetId: id });
  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, id)).get();
  return c.json({ user });
});

usersRoutes.post("/:id/suspend", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  await db.update(vpnUsers).set({ status: "SUSPENDED" }).where(eq(vpnUsers.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "user.suspend", targetType: "VpnUser", targetId: id });
  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, id)).get();
  return c.json({ user });
});

usersRoutes.post("/:id/enable", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  await db.update(vpnUsers).set({ status: "ACTIVE" }).where(eq(vpnUsers.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "user.enable", targetType: "VpnUser", targetId: id });
  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, id)).get();
  return c.json({ user });
});

usersRoutes.delete("/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  await attemptDeprovisioning(c.env, id).catch(() => undefined);
  const db = getDb(c.env);
  await db.delete(vpnUsers).where(eq(vpnUsers.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "user.delete", targetType: "VpnUser", targetId: id });
  return c.body(null, 204);
});

usersRoutes.post("/:id/provision", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const provisioning = await attemptProvisioning(c.env, id);
  await logActivity(c.env, { adminId: auth.adminId, action: "user.provision.retry", targetType: "VpnUser", targetId: id });
  return c.json({ provisioning });
});

usersRoutes.post("/:id/config/regenerate", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  try {
    const generated = await generateConfiguration(c.env, id);
    await logActivity(c.env, { adminId: auth.adminId, action: "user.config.regenerate", targetType: "VpnUser", targetId: id });
    return c.json({ configuration: generated.primary, configurations: generated.all });
  } catch (err) {
    const message = err instanceof ConfigGenerationError ? err.message : "Unable to regenerate configuration";
    return badRequest(c, message);
  }
});
