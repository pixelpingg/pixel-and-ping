import { eq, and, lt } from "drizzle-orm";
import { getDb } from "../lib/db";
import { vpnUsers } from "../db/schema";
import { createNotification } from "./notificationService";
import type { Env } from "../lib/env";

/** Run from the Cron Trigger (src/scheduled.ts) — see expiryService.ts's Node twin. */
export async function sweepExpiredUsers(env: Env) {
  const db = getDb(env);
  const now = new Date();
  const expired = await db.select().from(vpnUsers).where(and(eq(vpnUsers.status, "ACTIVE"), lt(vpnUsers.expiresAt, now))).all();
  if (expired.length === 0) return { expired: 0 };

  for (const u of expired) {
    await db.update(vpnUsers).set({ status: "EXPIRED" }).where(eq(vpnUsers.id, u.id));
    await createNotification(env, { level: "WARNING", title: "User expired", message: `${u.username}'s access expired and was automatically disabled.` });
  }
  return { expired: expired.length };
}
