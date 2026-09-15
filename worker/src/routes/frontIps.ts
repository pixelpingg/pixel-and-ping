import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { frontIps } from "../db/schema";
import { newId } from "../lib/crypto";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { badRequest, notFound } from "../lib/response";
import { logActivity } from "../services/activityLogService";
import type { Env } from "../lib/env";

export const frontIpsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
frontIpsRoutes.use("*", requireAuth);

// A snapshot of Cloudflare's own officially published IPv4 ranges
// (https://www.cloudflare.com/ips/, page last updated 2023-09-28) — one
// representative address from each announced CIDR block, not an
// exhaustive expansion of every address in every range (that's millions
// of addresses and serves no purpose here: this is a curated pool for
// config generation, not something meant to be probed exhaustively).
// Re-check that page occasionally; Cloudflare does add/retire ranges.
const CLOUDFLARE_SEED_IPS: { address: string; label: string }[] = [
  { address: "103.21.244.1", label: "Cloudflare range 103.21.244.0/22" },
  { address: "103.22.200.1", label: "Cloudflare range 103.22.200.0/22" },
  { address: "103.31.4.1", label: "Cloudflare range 103.31.4.0/22" },
  { address: "104.16.0.1", label: "Cloudflare range 104.16.0.0/13" },
  { address: "104.24.0.1", label: "Cloudflare range 104.24.0.0/14" },
  { address: "108.162.192.1", label: "Cloudflare range 108.162.192.0/18" },
  { address: "131.0.72.1", label: "Cloudflare range 131.0.72.0/22" },
  { address: "141.101.64.1", label: "Cloudflare range 141.101.64.0/18" },
  { address: "162.158.0.1", label: "Cloudflare range 162.158.0.0/15" },
  { address: "172.64.0.1", label: "Cloudflare range 172.64.0.0/13" },
  { address: "173.245.48.1", label: "Cloudflare range 173.245.48.0/20" },
  { address: "188.114.96.1", label: "Cloudflare range 188.114.96.0/20" },
  { address: "190.93.240.1", label: "Cloudflare range 190.93.240.0/20" },
  { address: "197.234.240.1", label: "Cloudflare range 197.234.240.0/22" },
  { address: "198.41.128.1", label: "Cloudflare range 198.41.128.0/17" },
];

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

frontIpsRoutes.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(frontIps).all();
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return c.json({ frontIps: rows });
});

// Idempotent — safe to call repeatedly; only inserts ranges not already
// present (whether seeded before or added manually with the same address).
frontIpsRoutes.post("/seed", requireRole("ADMIN"), async (c) => {
  const db = getDb(c.env);
  const existing = new Set((await db.select().from(frontIps).all()).map((r) => r.address));
  const now = new Date();
  const toInsert = CLOUDFLARE_SEED_IPS.filter((ip) => !existing.has(ip.address)).map((ip) => ({
    id: newId(),
    address: ip.address,
    label: ip.label,
    source: "SEED",
    createdAt: now,
  }));
  if (toInsert.length > 0) await db.insert(frontIps).values(toInsert);
  return c.json({ inserted: toInsert.length });
});

const addSchema = z.object({ address: z.string().min(1), label: z.string().optional() });

frontIpsRoutes.post("/", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const parsed = addSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, "Invalid IP entry");
  const address = parsed.data.address.trim();
  if (!IPV4_RE.test(address)) return badRequest(c, "Only IPv4 addresses are supported");

  const db = getDb(c.env);
  const already = await db.select().from(frontIps).where(eq(frontIps.address, address)).get();
  if (already) return badRequest(c, "This address is already in your pool");

  const row = { id: newId(), address, label: parsed.data.label ?? null, source: "CUSTOM", createdAt: new Date() };
  await db.insert(frontIps).values(row);
  await logActivity(c.env, { adminId: auth.adminId, action: "frontip.add", targetType: "FrontIp", targetId: row.id });
  return c.json({ frontIp: row }, 201);
});

frontIpsRoutes.delete("/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  const existing = await db.select().from(frontIps).where(eq(frontIps.id, id)).get();
  if (!existing) return notFound(c, "Not found");
  await db.delete(frontIps).where(eq(frontIps.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "frontip.delete", targetType: "FrontIp", targetId: id });
  return c.json({ ok: true });
});
