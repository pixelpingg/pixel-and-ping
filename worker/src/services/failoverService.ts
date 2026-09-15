import { eq, desc } from "drizzle-orm";
import { getDb } from "../lib/db";
import { endpoints, healthChecks, failoverEvents, failoverSettings, servers } from "../db/schema";
import { checkEndpointHealth } from "./healthCheckService";
import { createNotification } from "./notificationService";
import { newId } from "../lib/crypto";
import type { Env } from "../lib/env";

async function getSettings(env: Env) {
  const db = getDb(env);
  const existing = await db.select().from(failoverSettings).limit(1).get();
  if (existing) return existing;
  const row = { id: newId(), enabled: false, failureThreshold: 3, retryCount: 2, healthCheckIntervalSec: 30, recoveryThreshold: 2, strategy: "HEALTH_BASED", updatedAt: new Date() };
  await db.insert(failoverSettings).values(row);
  return row;
}

export async function evaluateFailover(env: Env, serverId: string) {
  const settings = await getSettings(env);
  if (!settings.enabled) return null;

  const db = getDb(env);
  const serverEndpoints = await db.select().from(endpoints).where(eq(endpoints.serverId, serverId)).all();
  const primary = serverEndpoints.find((e) => e.isPrimary);
  if (!primary) return null;

  const recentChecks = await db.select().from(healthChecks).where(eq(healthChecks.endpointId, primary.id)).orderBy(desc(healthChecks.checkedAt)).limit(settings.failureThreshold).all();
  const consecutiveFailures = recentChecks.length === settings.failureThreshold && recentChecks.every((c) => !c.success);
  if (!consecutiveFailures) return null;

  const candidates = serverEndpoints
    .filter((e) => e.id !== primary.id && !["OFFLINE", "POOR", "UNKNOWN"].includes(e.health))
    .sort((a, b) => b.score - a.score);

  const next = candidates[0];
  if (!next) {
    await createNotification(env, { level: "CRITICAL", title: "Failover unavailable", message: `Endpoint ${primary.label} is unhealthy and no healthy alternative was found.` });
    return null;
  }

  // Re-verify with a fresh probe before switching — never trust stale health.
  const verified = await checkEndpointHealth(env, next.id);
  if (verified.health === "OFFLINE" || verified.health === "POOR") return null;

  await db.update(endpoints).set({ isPrimary: false }).where(eq(endpoints.id, primary.id));
  await db.update(endpoints).set({ isPrimary: true }).where(eq(endpoints.id, next.id));
  await db.insert(failoverEvents).values({
    id: newId(),
    fromEndpointId: primary.id,
    toEndpointId: next.id,
    reason: `Primary endpoint failed ${settings.failureThreshold}+ consecutive health checks`,
    triggeredAt: new Date(),
    automatic: true,
  });
  await createNotification(env, { level: "WARNING", title: "Automatic failover triggered", message: `Traffic moved from ${primary.label} to ${next.label}.` });
  return { from: primary, to: next };
}

export async function evaluateRecovery(env: Env, serverId: string) {
  const settings = await getSettings(env);
  if (!settings.enabled) return null;

  const db = getDb(env);
  const lastEvent = await db.select().from(failoverEvents).orderBy(desc(failoverEvents.triggeredAt)).limit(1).get();
  if (!lastEvent?.fromEndpointId || !lastEvent.toEndpointId) return null;

  const demoted = await db.select().from(endpoints).where(eq(endpoints.id, lastEvent.fromEndpointId)).get();
  const currentPrimary = await db.select().from(endpoints).where(eq(endpoints.id, lastEvent.toEndpointId)).get();
  if (!demoted || !currentPrimary || demoted.serverId !== serverId || demoted.isPrimary) return null;

  const recentChecks = await db.select().from(healthChecks).where(eq(healthChecks.endpointId, demoted.id)).orderBy(desc(healthChecks.checkedAt)).limit(settings.recoveryThreshold).all();
  const consecutiveSuccesses = recentChecks.length === settings.recoveryThreshold && recentChecks.every((c) => c.success);
  if (!consecutiveSuccesses || demoted.score < currentPrimary.score) return null;

  await db.update(endpoints).set({ isPrimary: false }).where(eq(endpoints.id, currentPrimary.id));
  await db.update(endpoints).set({ isPrimary: true }).where(eq(endpoints.id, demoted.id));
  await db.insert(failoverEvents).values({
    id: newId(),
    fromEndpointId: currentPrimary.id,
    toEndpointId: demoted.id,
    reason: `Recovered endpoint passed ${settings.recoveryThreshold} consecutive health checks — failed back`,
    triggeredAt: new Date(),
    automatic: true,
  });
  await createNotification(env, { level: "INFO", title: "Endpoint recovered", message: `${demoted.label} recovered and traffic failed back to it.` });
  return { from: currentPrimary, to: demoted };
}

export async function evaluateFailoverForAllServers(env: Env) {
  const db = getDb(env);
  const enabledServers = await db.select().from(servers).where(eq(servers.isEnabled, true)).all();
  const results = [];
  for (const server of enabledServers) {
    const f = await evaluateFailover(env, server.id);
    if (f) {
      results.push({ serverId: server.id, ...f });
      continue;
    }
    const r = await evaluateRecovery(env, server.id);
    if (r) results.push({ serverId: server.id, ...r });
  }
  return results;
}
