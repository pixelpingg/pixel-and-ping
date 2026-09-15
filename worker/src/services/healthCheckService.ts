import { connect } from "cloudflare:sockets";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../lib/db";
import { endpoints, healthChecks } from "../db/schema";
import { newId } from "../lib/crypto";
import { createNotification } from "./notificationService";
import type { Env } from "../lib/env";

export interface HealthResult {
  success: boolean;
  latencyMs: number | null;
  tlsOk: boolean | null;
  errorMessage: string | null;
}

/**
 * Real TCP/TLS reachability probe using the Workers-native `connect()` API
 * from `cloudflare:sockets` — this is a genuine Cloudflare Workers
 * capability (announced Developer Week 2023), not a simulation. It opens
 * an outbound TCP socket to the exact host:port of an endpoint already
 * registered in the operator's own inventory, optionally negotiating TLS,
 * and reports whether the handshake succeeded.
 *
 * Known Workers platform constraints (real, not a limitation of this
 * code): outbound sockets to Cloudflare's own IP ranges are blocked,
 * port 25 is blocked, and a socket cannot be created outside a request
 * handler — all consistent with only ever probing pre-registered,
 * operator-owned endpoints, never arbitrary hosts.
 */
export async function probeEndpoint(host: string, port: number, useTls: boolean, timeoutMs = 5000): Promise<HealthResult> {
  const start = Date.now();
  try {
    const socket = connect(
      { hostname: host, port },
      useTls ? { secureTransport: "on", allowHalfOpen: false } : { secureTransport: "off", allowHalfOpen: false }
    );

    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out")), timeoutMs));

    await Promise.race([socket.opened, timeout]);
    const latencyMs = Date.now() - start;

    await socket.close().catch(() => undefined);
    return { success: true, latencyMs, tlsOk: useTls ? true : null, errorMessage: null };
  } catch (err) {
    return { success: false, latencyMs: null, tlsOk: null, errorMessage: err instanceof Error ? err.message : "Connection failed" };
  }
}

export function computeScore(params: { successRatio: number; avgLatencyMs: number | null }): number {
  // Every recent probe failed — this is a fact, not missing data, so none
  // of the "neutral bonus for unknown" logic below should apply. Without
  // this early return, the flat +15 (unknown latency) and +10 (unmeasured
  // packet loss) bonuses always pushed the score to at least 25, which
  // made scoreToHealthLabel's score===0 "OFFLINE" branch mathematically
  // unreachable — a fully dead endpoint was permanently mislabeled "POOR".
  if (params.successRatio === 0) return 0;

  let score = params.successRatio * 60;
  if (params.avgLatencyMs !== null) {
    score += Math.min(30, Math.max(0, 30 - params.avgLatencyMs / 20));
  } else {
    score += 15;
  }
  score += 10; // packet-loss component not measurable via connect() alone; neutral weight
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreToHealthLabel(score: number): "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "OFFLINE" {
  if (score === 0) return "OFFLINE";
  if (score >= 85) return "EXCELLENT";
  if (score >= 65) return "GOOD";
  if (score >= 40) return "FAIR";
  return "POOR";
}

export async function checkEndpointHealth(env: Env, endpointId: string) {
  const db = getDb(env);
  const endpoint = await db.select().from(endpoints).where(eq(endpoints.id, endpointId)).get();
  if (!endpoint) throw new Error("Endpoint not found");

  const result = await probeEndpoint(endpoint.host, endpoint.port, true);

  await db.insert(healthChecks).values({
    id: newId(),
    endpointId: endpoint.id,
    serverId: endpoint.serverId,
    latencyMs: result.latencyMs,
    tlsOk: result.tlsOk,
    success: result.success,
    errorMessage: result.errorMessage,
    checkedAt: new Date(),
  });

  const recent = await db.select().from(healthChecks).where(eq(healthChecks.endpointId, endpoint.id)).orderBy(desc(healthChecks.checkedAt)).limit(20).all();
  const successRatio = recent.filter((r) => r.success).length / recent.length;
  const latencies = recent.filter((r) => r.latencyMs !== null).map((r) => r.latencyMs as number);
  const avgLatencyMs = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  const score = computeScore({ successRatio, avgLatencyMs });
  const health = scoreToHealthLabel(score);
  const previousHealth = endpoint.health;

  await db.update(endpoints).set({ latencyMs: result.latencyMs, tlsOk: result.tlsOk, score, health, lastCheckedAt: new Date() }).where(eq(endpoints.id, endpoint.id));

  const wasUnhealthy = previousHealth === "OFFLINE" || previousHealth === "POOR";
  const isUnhealthyNow = health === "OFFLINE" || health === "POOR";
  if (!wasUnhealthy && isUnhealthyNow) {
    await createNotification(env, { level: "WARNING", title: "Endpoint unhealthy", message: `${endpoint.label} degraded to ${health}.` });
  } else if (wasUnhealthy && !isUnhealthyNow) {
    await createNotification(env, { level: "INFO", title: "Endpoint recovered", message: `${endpoint.label} recovered to ${health}.` });
  }

  return { ...endpoint, latencyMs: result.latencyMs, tlsOk: result.tlsOk, score, health };
}

export async function checkAllEndpoints(env: Env) {
  const db = getDb(env);
  const all = await db.select().from(endpoints).all();
  const results = [];
  for (const ep of all) {
    try {
      results.push(await checkEndpointHealth(env, ep.id));
    } catch {
      // one endpoint failing to probe never aborts the batch
    }
  }
  return results;
}
