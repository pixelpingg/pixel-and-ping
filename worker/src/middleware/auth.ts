import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { verifyJwt } from "../lib/jwt";
import { getDb } from "../lib/db";
import { admins, sessions } from "../db/schema";
import type { Env } from "../lib/env";

export interface AuthPayload {
  adminId: string;
  role: string;
  sessionId: string;
}

const COOKIE_NAME = "pp_session";

export async function requireAuth(c: Context<{ Bindings: Env; Variables: { auth: AuthPayload } }>, next: Next) {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);

  try {
    const payload = await verifyJwt<AuthPayload>(token, c.env.JWT_SECRET);
    const db = getDb(c.env);

    const session = await db.select().from(sessions).where(eq(sessions.id, payload.sessionId)).get();
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Session expired. Please log in again." } }, 401);
    }

    const admin = await db.select().from(admins).where(eq(admins.id, payload.adminId)).get();
    if (!admin || !admin.isActive) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Account disabled" } }, 401);
    }

    c.set("auth", { adminId: admin.id, role: admin.role, sessionId: session.id });
    await next();
  } catch {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired session" } }, 401);
  }
}

export function requireRole(...roles: string[]) {
  return async (c: Context<{ Bindings: Env; Variables: { auth: AuthPayload } }>, next: Next) => {
    const auth = c.get("auth");
    if (!auth) return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    if (auth.role === "SUPER_ADMIN") return next();
    if (!roles.includes(auth.role)) {
      return c.json({ error: { code: "FORBIDDEN", message: "Your role does not permit this action" } }, 403);
    }
    await next();
  };
}

export { COOKIE_NAME };
