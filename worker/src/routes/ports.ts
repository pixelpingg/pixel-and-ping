import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { ports } from "../db/schema";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { badRequest, conflict } from "../lib/response";
import type { Env } from "../lib/env";

export const portsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
portsRoutes.use("*", requireAuth);

export const WELL_KNOWN_TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];
export const WELL_KNOWN_NON_TLS_PORTS = [80, 8080, 2052, 2082, 2086, 2095];

portsRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(ports).all();
  rows.sort((a, b) => a.number - b.number);
  return c.json({ ports: rows, presets: { tls: WELL_KNOWN_TLS_PORTS, nonTls: WELL_KNOWN_NON_TLS_PORTS } });
});

const createPortSchema = z.object({ number: z.number().int().min(1).max(65535), type: z.enum(["TLS", "NON_TLS", "CUSTOM"]), label: z.string().optional() });

portsRoutes.post("/", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = createPortSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid port data");
  const db = getDb(c.env);

  const existing = await db.select().from(ports).where(eq(ports.number, parsed.data.number)).get();
  if (existing) return conflict(c, "This port is already registered");

  const id = newId();
  await db.insert(ports).values({ id, number: parsed.data.number, type: parsed.data.type, label: parsed.data.label ?? null, isActive: false, createdAt: new Date() });
  await logActivity(c.env, { adminId: auth.adminId, action: "port.create", targetType: "Port", targetId: id });
  const port = await db.select().from(ports).where(eq(ports.id, id)).get();
  return c.json({ port }, 201);
});

/**
 * Confirming a port is actually bindable requires a listening socket on
 * the box the process runs on — meaningful on a persistent Node server,
 * meaningless for a stateless Worker invocation (there is no "this host"
 * to bind on; each request may run on a different edge location, and
 * Workers cannot open listening sockets at all). Marking a port "active"
 * here is therefore based on it being a syntactically valid, non-reserved
 * port number Cloudflare itself accepts for proxied traffic (the
 * WELL_KNOWN_* lists above, or a valid custom range) — NOT a live bind
 * test. This is intentionally more conservative than the Node version's
 * literal socket bind and is documented as such rather than faked.
 */
portsRoutes.post("/:id/validate", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  const port = await db.select().from(ports).where(eq(ports.id, id)).get();
  if (!port) return badRequest(c, "Port not found");

  const allKnown = [...WELL_KNOWN_TLS_PORTS, ...WELL_KNOWN_NON_TLS_PORTS];
  const validRange = port.number >= 1 && port.number <= 65535;
  const bindable = port.type === "CUSTOM" ? validRange : allKnown.includes(port.number);

  await db.update(ports).set({ isActive: bindable, lastCheckedAt: new Date() }).where(eq(ports.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "port.validate", targetType: "Port", targetId: id, metadata: { bindable } });
  const updated = await db.select().from(ports).where(eq(ports.id, id)).get();
  return c.json({ port: updated, bindable });
});

portsRoutes.delete("/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  await db.delete(ports).where(eq(ports.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "port.delete", targetType: "Port", targetId: id });
  return c.body(null, 204);
});
