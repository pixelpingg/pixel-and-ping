import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { admins, sessions, twoFactorRecoveryCodes } from "../db/schema";
import { signJwt } from "../lib/jwt";
import { newId } from "../lib/crypto";
import { requireAuth, COOKIE_NAME, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { rateLimitHit } from "../lib/kv";
import type { Env } from "../lib/env";

export const authRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();

const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

const loginSchema = z.object({
  password: z.string().min(1),
  totpCode: z.string().optional(),
  recoveryCode: z.string().optional(),
});

authRoutes.post("/login", async (c) => {
  // Same 10-attempts/15-minutes throttle as backend/src/middleware/
  // rateLimit.ts's authRateLimiter — this got dropped when the Node
  // Express middleware was ported to the Worker, leaving the admin login
  // (whose bootstrap password is the well-known literal "admin") open to
  // unlimited brute-force/credential-stuffing attempts. KV-backed since
  // Workers have no persistent in-memory rate limiter like express-rate-limit.
  const clientIp = c.req.header("cf-connecting-ip") ?? "unknown";
  const { allowed } = await rateLimitHit(c.env, `ratelimit:login:${clientIp}`, 10, 15 * 60);
  if (!allowed) {
    return c.json({ error: { code: "TOO_MANY_REQUESTS", message: "Too many login attempts. Try again later." } }, 429);
  }

  // Be deliberately tolerant of clients/proxies that omit the JSON content type.
  // The login contract is still exactly { password, totpCode?, recoveryCode? }.
  // Accept JSON from the Vite proxy and, for local/dev tooling, also accept
  // a form body. This avoids rejecting an otherwise valid password because

  // a proxy/client omitted the JSON content-type.
  let body: unknown;
  try {
    const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await c.req.parseBody();
      body = {
        password: typeof form.password === "string" ? form.password : "",
        totpCode: typeof form.totpCode === "string" ? form.totpCode : undefined,
        recoveryCode: typeof form.recoveryCode === "string" ? form.recoveryCode : undefined,
      };
    } else {
      // Last-resort JSON parse for clients that send JSON without a content-type.
      const raw = await c.req.text();
      body = JSON.parse(raw);
    }
  } catch {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request body" } }, 400);
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } }, 400);
  const { password, totpCode, recoveryCode } = parsed.data;

  const db = getDb(c.env);

  // Password-only bootstrap: the first login creates the initial local
  // administrator. Cloudflare does not expose the deployer's account email
  // to a Worker automatically, so email is kept as an internal field only.
  let activeAdmins = await db.select().from(admins).all();
  let admin = activeAdmins.find((a) => a.isActive) ?? null;

  if (activeAdmins.length === 0) {
    if (password !== "admin") {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid password" } }, 401);
    }
    const now = new Date();
    const id = newId();
    const passwordHash = await bcrypt.hash("admin", 12);
    await db.insert(admins).values({
      id,
      email: "admin@pixelping.local",
      avatarUrl: null,
      username: "admin",
      passwordHash,
      role: "SUPER_ADMIN",
      twoFactorSecret: null,
      twoFactorPendingSecret: null,
      twoFactorEnabled: false,
      isActive: true,
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: now,
      updatedAt: now,
    });
    admin = await db.select().from(admins).where(eq(admins.id, id)).get() ?? null;
  } else {
    for (const candidate of activeAdmins.filter((a) => a.isActive)) {
      if (await bcrypt.compare(password, candidate.passwordHash)) {
        admin = candidate;
        break;
      }
    }
  }

  if (!admin || !admin.isActive) return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid password" } }, 401);

  if (admin.twoFactorEnabled) {
    if (recoveryCode) {
      const unused = await db.select().from(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.adminId, admin.id)).all();
      let matchedId: string | null = null;
      for (const codeRow of unused) {
        if (codeRow.usedAt) continue;
        if (await bcrypt.compare(recoveryCode, codeRow.codeHash)) {
          matchedId = codeRow.id;
          break;
        }
      }
      if (!matchedId) return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid or already-used recovery code" } }, 401);
      await db.update(twoFactorRecoveryCodes).set({ usedAt: new Date() }).where(eq(twoFactorRecoveryCodes.id, matchedId));
    } else if (!totpCode) {
      return c.json({ requiresTwoFactor: true });
    } else {
      if (!authenticator.check(totpCode, admin.twoFactorSecret ?? "")) {
        return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid 2FA code" } }, 401);
      }
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1000);
  const sessionId = newId();
  await db.insert(sessions).values({
    id: sessionId,
    adminId: admin.id,
    tokenHash: newId(),
    userAgent: c.req.header("user-agent") ?? null,
    ipAddress: c.req.header("cf-connecting-ip") ?? null,
    expiresAt,
    createdAt: now,
    revokedAt: null,
  });

  const token = await signJwt({ adminId: admin.id, role: admin.role, sessionId }, c.env.JWT_SECRET, SESSION_LIFETIME_SECONDS);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    // Workers are always deployed behind Cloudflare's HTTPS edge, so this
    // stays true unconditionally in production. For local `wrangler dev`
    // testing, run it with `--local-protocol https` (or test against a
    // deployed preview URL) — a plain-HTTP dev server will not receive
    // this cookie back, by design; weakening it by default would leave a
    // real security footgun in for production.
    // Local Wrangler runs on http://127.0.0.1, while deployed Workers use
    // HTTPS. Keep the cookie secure in production but allow local testing.
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });

  await db.update(admins).set({ lastLoginAt: now, lastLoginIp: c.req.header("cf-connecting-ip") ?? null }).where(eq(admins.id, admin.id));
  await logActivity(c.env, { adminId: admin.id, action: "auth.login", ipAddress: c.req.header("cf-connecting-ip") ?? undefined });

  return c.json({ admin: { id: admin.id, email: admin.email, username: admin.username, role: admin.role, avatarUrl: admin.avatarUrl ?? null } });
});



const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

authRoutes.post("/change-password", requireAuth, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "New password must be at least 8 characters" } }, 400);
  const db = getDb(c.env);
  const admin = await db.select().from(admins).where(eq(admins.id, auth.adminId)).get();
  if (!admin) return c.json({ error: { code: "NOT_FOUND", message: "Admin not found" } }, 404);
  if (!(await bcrypt.compare(parsed.data.currentPassword, admin.passwordHash))) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Current password is incorrect" } }, 401);
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await db.update(admins).set({ passwordHash, updatedAt: new Date() }).where(eq(admins.id, admin.id));
  await logActivity(c.env, { adminId: admin.id, action: "auth.password_changed" });
  return c.json({ ok: true });
});

const profileSchema = z.object({
  avatarUrl: z.string().max(280_000).nullable().optional(),
});

authRoutes.patch("/profile", requireAuth, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid profile data" } }, 400);
  const db = getDb(c.env);
  const admin = await db.select().from(admins).where(eq(admins.id, auth.adminId)).get();
  if (!admin) return c.json({ error: { code: "NOT_FOUND", message: "Admin not found" } }, 404);
  await db.update(admins).set({ avatarUrl: parsed.data.avatarUrl ?? null, updatedAt: new Date() }).where(eq(admins.id, admin.id));
  await logActivity(c.env, { adminId: admin.id, action: "auth.profile_updated" });
  return c.json({ admin: { id: admin.id, email: admin.email, username: admin.username, role: admin.role, avatarUrl: parsed.data.avatarUrl ?? null } });
});

authRoutes.post("/logout", requireAuth, async (c) => {
  const auth = c.get("auth");
  const db = getDb(c.env);
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, auth.sessionId));
  await logActivity(c.env, { adminId: auth.adminId, action: "auth.logout" });
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const auth = c.get("auth");
  const db = getDb(c.env);
  const admin = await db.select().from(admins).where(eq(admins.id, auth.adminId)).get();
  if (!admin) return c.json({ error: { code: "NOT_FOUND", message: "Admin not found" } }, 404);
  return c.json({
    admin: { id: admin.id, email: admin.email, username: admin.username, role: admin.role, avatarUrl: admin.avatarUrl ?? null, twoFactorEnabled: admin.twoFactorEnabled },
  });
});

// ---------------------------------------------------------------------
// 2FA — same flow as backend/src/routes/twoFactor.ts
// ---------------------------------------------------------------------

authRoutes.post("/2fa/setup", requireAuth, async (c) => {
  const auth = c.get("auth");
  const db = getDb(c.env);
  const admin = await db.select().from(admins).where(eq(admins.id, auth.adminId)).get();
  if (!admin) return c.json({ error: { code: "NOT_FOUND", message: "Admin not found" } }, 404);
  if (admin.twoFactorEnabled) return c.json({ error: { code: "CONFLICT", message: "2FA is already enabled" } }, 409);

  const secret = authenticator.generateSecret();
  await db.update(admins).set({ twoFactorPendingSecret: secret }).where(eq(admins.id, admin.id));

  const otpauth = authenticator.keyuri(admin.email, "Pixel & Ping", secret);
  const qrDataUrl = await qrcode.toDataURL(otpauth);

  return c.json({ secret, otpauth, qrDataUrl });
});

const verifySchema = z.object({ totpCode: z.string().min(6).max(6) });

authRoutes.post("/2fa/verify", requireAuth, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid code" } }, 400);

  const db = getDb(c.env);
  const admin = await db.select().from(admins).where(eq(admins.id, auth.adminId)).get();
  if (!admin?.twoFactorPendingSecret) return c.json({ error: { code: "BAD_REQUEST", message: "No pending 2FA setup" } }, 400);
  if (!authenticator.check(parsed.data.totpCode, admin.twoFactorPendingSecret)) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid verification code" } }, 401);
  }

  const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomUUID().replace(/-/g, "").slice(0, 10));
  const hashed = await Promise.all(recoveryCodes.map((code) => bcrypt.hash(code, 10)));

  await db.update(admins).set({ twoFactorSecret: admin.twoFactorPendingSecret, twoFactorPendingSecret: null, twoFactorEnabled: true }).where(eq(admins.id, admin.id));
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.adminId, admin.id));
  for (const codeHash of hashed) {
    await db.insert(twoFactorRecoveryCodes).values({ id: newId(), adminId: admin.id, codeHash, createdAt: new Date() });
  }

  await logActivity(c.env, { adminId: admin.id, action: "2fa.enabled" });
  return c.json({ enabled: true, recoveryCodes });
});

const disableSchema = z.object({ password: z.string().min(1) });

authRoutes.post("/2fa/disable", requireAuth, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "VALIDATION_ERROR", message: "Password required" } }, 400);

  const db = getDb(c.env);
  const admin = await db.select().from(admins).where(eq(admins.id, auth.adminId)).get();
  if (!admin) return c.json({ error: { code: "NOT_FOUND", message: "Admin not found" } }, 404);
  if (!(await bcrypt.compare(parsed.data.password, admin.passwordHash))) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Incorrect password" } }, 401);
  }

  await db.update(admins).set({ twoFactorEnabled: false, twoFactorSecret: null, twoFactorPendingSecret: null }).where(eq(admins.id, admin.id));
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.adminId, admin.id));
  await logActivity(c.env, { adminId: admin.id, action: "2fa.disabled" });
  return c.json({ enabled: false });
});

authRoutes.get("/2fa/status", requireAuth, async (c) => {
  const auth = c.get("auth");
  const db = getDb(c.env);
  const admin = await db.select().from(admins).where(eq(admins.id, auth.adminId)).get();
  if (!admin) return c.json({ error: { code: "NOT_FOUND", message: "Admin not found" } }, 404);
  const allCodes = await db.select().from(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.adminId, admin.id)).all();
  const remaining = allCodes.filter((code) => !code.usedAt).length;
  return c.json({ enabled: admin.twoFactorEnabled, remainingRecoveryCodes: remaining });
});
