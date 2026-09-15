import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../lib/db";
import { cloudflareAccounts, cloudflareUsageSnapshots } from "../db/schema";
import * as cf from "../services/cloudflareService";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { badRequest, unauthorized, upstream } from "../lib/response";
import type { Env } from "../lib/env";

export const cloudflareRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
cloudflareRoutes.use("*", requireAuth);

// Never select encryptedToken/tokenIv/tokenAuthTag in any response.
function toPublicAccount(a: typeof cloudflareAccounts.$inferSelect) {
  const { encryptedToken, tokenIv, tokenAuthTag, ...safe } = a;
  return safe;
}

// Maps a thrown error from the cloudflareService layer to the right HTTP
// status instead of flattening every failure to a generic 400. Previously
// EVERY failure here — a genuinely bad token (401), a rate limit (429), a
// Cloudflare outage (502), *and* an unrelated internal error (a DB write
// failure, a misconfigured ENCRYPTION_KEY, etc.) — all produced the exact
// same "Could not verify this API token" / 400 response, which made a
// perfectly valid token look broken and made the real cause undiagnosable.
function respondCfError(c: Parameters<typeof badRequest>[0], err: unknown) {
  if (err instanceof cf.CloudflareApiError) {
    if (err.status === 401 || err.status === 403) return unauthorized(c, err.message);
    if (err.status === 429 || err.status >= 500) return upstream(c, err.message);
    return badRequest(c, err.message);
  }
  // Not a Cloudflare-side rejection at all — surface what actually broke
  // (e.g. encryption/storage) instead of blaming the token.
  const detail = err instanceof Error ? err.message : "Unknown error";
  return badRequest(c, `Could not save this account: ${detail}`);
}

cloudflareRoutes.get("/accounts", async (c) => {
  await cf.ensureSelfAccount(c.env);
  const db = getDb(c.env);
  const rows = await db.select().from(cloudflareAccounts).all();
  return c.json({ accounts: rows.map(toPublicAccount) });
});

// No accountId needed — this is always the operator's own account
// (CF_ACCOUNT_ID/CF_API_TOKEN, deploy-time secrets), auto-bootstrapped
// by ensureSelfAccount. Returns { configured: false } rather than an
// error when those secrets aren't set, since this is an optional widget.
cloudflareRoutes.get("/self-usage", async (c) => {
  try {
    await cf.ensureSelfAccount(c.env);
    const usage = await cf.getSelfUsage(c.env);
    return c.json(usage);
  } catch (err) {
    return respondCfError(c, err);
  }
});

// .trim() on accountId/apiToken: a stray leading/trailing space or newline
// from copy-pasting the token out of the Cloudflare dashboard still passes
// min-length validation but produces a malformed Authorization header,
// which Cloudflare rejects — surfacing as exactly the "can't verify a
// clearly-valid token" symptom. Trimming here removes that failure mode
// entirely instead of requiring the user to notice invisible whitespace.
const addAccountSchema = z.object({
  name: z.string().min(2).transform((v) => v.trim()),
  accountId: z.string().min(4).transform((v) => v.trim()),
  apiToken: z.string().min(10).transform((v) => v.trim()),
});

cloudflareRoutes.post("/accounts", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json().catch(() => null);
  const parsed = addAccountSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid account data");

  try {
    const account = await cf.addCloudflareAccount(c.env, parsed.data);
    await logActivity(c.env, { adminId: auth.adminId, action: "cloudflare.account.add", targetType: "CloudflareAccount", targetId: account.id });
    return c.json({ account: toPublicAccount(account as any) }, 201);
  } catch (err) {
    return respondCfError(c, err);
  }
});

cloudflareRoutes.post("/accounts/:id/test", async (c) => {
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  const account = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).get();
  if (!account) return badRequest(c, "Account not found");
  try {
    const token = await (async () => {
      const { decryptSecret } = await import("../lib/crypto");
      return decryptSecret({ ciphertext: account.encryptedToken, iv: account.tokenIv, authTag: account.tokenAuthTag }, c.env.ENCRYPTION_KEY);
    })();
    const result = await cf.verifyToken(token);
    await db.update(cloudflareAccounts).set({ status: "HEALTHY", lastSyncAt: new Date(), lastSyncError: null }).where(eq(cloudflareAccounts.id, id));
    return c.json({ ok: true, status: result.status });
  } catch (err) {
    const message = err instanceof cf.CloudflareApiError ? err.message : err instanceof Error ? err.message : "Connection failed";
    await db.update(cloudflareAccounts).set({ status: "UNHEALTHY", lastSyncError: message }).where(eq(cloudflareAccounts.id, id));
    return respondCfError(c, err);
  }
});

cloudflareRoutes.post("/accounts/:id/toggle", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  const account = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).get();
  if (!account) return badRequest(c, "Account not found");
  await db.update(cloudflareAccounts).set({ isActive: !account.isActive }).where(eq(cloudflareAccounts.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "cloudflare.account.toggle", targetType: "CloudflareAccount", targetId: id });
  const updated = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).get();
  return c.json({ account: toPublicAccount(updated!) });
});

cloudflareRoutes.delete("/accounts/:id", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const db = getDb(c.env);
  await db.delete(cloudflareAccounts).where(eq(cloudflareAccounts.id, id));
  await logActivity(c.env, { adminId: auth.adminId, action: "cloudflare.account.remove", targetType: "CloudflareAccount", targetId: id });
  return c.body(null, 204);
});

cloudflareRoutes.get("/accounts/:id/zones", async (c) => {
  try {
    const zones = await cf.listZones(c.env, c.req.param("id")!);
    return c.json({ zones });
  } catch (err) {
    return respondCfError(c, err);
  }
});

cloudflareRoutes.get("/accounts/:id/workers", async (c) => {
  try {
    const workers = await cf.listWorkers(c.env, c.req.param("id")!);
    if (workers === null) return c.json({ workers: null, message: "Unavailable from Cloudflare API" });
    return c.json({ workers });
  } catch (err) {
    return respondCfError(c, err);
  }
});

cloudflareRoutes.get("/accounts/:id/usage", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(cloudflareUsageSnapshots).where(eq(cloudflareUsageSnapshots.accountId, c.req.param("id")!)).orderBy(desc(cloudflareUsageSnapshots.capturedAt)).limit(90).all();
  return c.json({ snapshots: rows });
});

cloudflareRoutes.get("/accounts/:id/usage/by-zone", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(cloudflareUsageSnapshots).where(eq(cloudflareUsageSnapshots.accountId, c.req.param("id")!)).orderBy(desc(cloudflareUsageSnapshots.capturedAt)).limit(200).all();
  const latestByZone = new Map<string, (typeof rows)[number]>();
  for (const s of rows) if (s.zoneId && !latestByZone.has(s.zoneId)) latestByZone.set(s.zoneId, s);
  return c.json({ zones: [...latestByZone.values()] });
});

cloudflareRoutes.post("/sync", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  await cf.syncAllCloudflareAccounts(c.env);
  await logActivity(c.env, { adminId: auth.adminId, action: "cloudflare.sync" });
  return c.json({ ok: true });
});
