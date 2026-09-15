import { eq, and, isNull, lt } from "drizzle-orm";
import { getDb } from "../lib/db";
import { connectionSessions, vpnUsers } from "../db/schema";
import { newId } from "../lib/crypto";
import type { Env } from "../lib/env";

export interface HeartbeatInput {
  userId: string;
  serverId?: string;
  endpointId?: string;
  clientIp?: string;
  connectionSessionId?: string;
}

/**
 * Identical contract to backend/src/providers/databasePresenceProvider.ts —
 * only real writers are POST /api/ingest/heartbeat and the Cron Trigger's
 * cleanupStaleSessions() call (src/scheduled.ts). Nothing here invents an
 * online state.
 */
export async function heartbeat(env: Env, input: HeartbeatInput): Promise<{ connectionSessionId: string }> {
  const db = getDb(env);
  const now = new Date();

  if (input.connectionSessionId) {
    const existing = await db.select().from(connectionSessions).where(eq(connectionSessions.id, input.connectionSessionId)).get();
    if (existing && !existing.endedAt) {
      await db.update(connectionSessions).set({ lastHeartbeatAt: now, endpointId: input.endpointId ?? existing.endpointId }).where(eq(connectionSessions.id, existing.id));
      await markUserOnline(env, input.userId, now, input.endpointId);
      return { connectionSessionId: existing.id };
    }
  }

  const id = newId();
  await db.insert(connectionSessions).values({
    id,
    userId: input.userId,
    serverId: input.serverId ?? null,
    endpointId: input.endpointId ?? null,
    clientIp: input.clientIp ?? null,
    startedAt: now,
    lastHeartbeatAt: now,
  });
  await markUserOnline(env, input.userId, now, input.endpointId);
  return { connectionSessionId: id };
}

async function markUserOnline(env: Env, userId: string, at: Date, endpointId?: string) {
  const db = getDb(env);
  await db
    .update(vpnUsers)
    .set({ isOnline: true, lastSeenAt: at, ...(endpointId ? { lastEndpointId: endpointId } : {}) })
    .where(eq(vpnUsers.id, userId));
}

export async function endSession(env: Env, connectionSessionId: string, reason: string): Promise<void> {
  const db = getDb(env);
  const session = await db.select().from(connectionSessions).where(eq(connectionSessions.id, connectionSessionId)).get();
  if (!session) return;
  await db.update(connectionSessions).set({ endedAt: new Date(), endReason: reason }).where(eq(connectionSessions.id, connectionSessionId));

  const stillOpen = await db.select().from(connectionSessions).where(and(eq(connectionSessions.userId, session.userId), isNull(connectionSessions.endedAt))).get();
  if (!stillOpen) {
    await db.update(vpnUsers).set({ isOnline: false }).where(eq(vpnUsers.id, session.userId));
  }
}

export async function cleanupStaleSessions(env: Env, timeoutSeconds: number): Promise<{ markedOffline: number }> {
  const db = getDb(env);
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000);

  const stale = await db.select().from(connectionSessions).where(and(isNull(connectionSessions.endedAt), lt(connectionSessions.lastHeartbeatAt, cutoff))).all();
  if (stale.length === 0) return { markedOffline: 0 };

  for (const s of stale) {
    await db.update(connectionSessions).set({ endedAt: new Date(), endReason: "heartbeat_timeout" }).where(eq(connectionSessions.id, s.id));
  }

  const affectedUserIds = [...new Set(stale.map((s) => s.userId))];
  let markedOffline = 0;
  for (const userId of affectedUserIds) {
    const stillOpen = await db.select().from(connectionSessions).where(and(eq(connectionSessions.userId, userId), isNull(connectionSessions.endedAt))).get();
    if (!stillOpen) {
      await db.update(vpnUsers).set({ isOnline: false }).where(eq(vpnUsers.id, userId));
      markedOffline++;
    }
  }
  return { markedOffline };
}
