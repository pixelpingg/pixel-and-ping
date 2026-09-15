import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { vpnUsers } from "../db/schema";
import { recordTraffic, recordRequests } from "../services/trafficIngestService";
import { heartbeat, endSession } from "../services/presenceService";
import { requireApiKey, type ApiKeyAuth } from "../middleware/apiKeyAuth";
import { rateLimitHit } from "../lib/kv";
import { badRequest, notFound } from "../lib/response";
import type { Env } from "../lib/env";

/**
 * ===========================================================================
 * INGESTION API — for authorized external services only (a real VPN
 * daemon, a metering sidecar). Same contract as the Node backend's
 * routes/ingest.ts; see README § Ingestion API for the full request/
 * response documentation. Nothing on the frontend calls these routes.
 * ===========================================================================
 */
export const ingestRoutes = new Hono<{ Bindings: Env; Variables: { apiKey: ApiKeyAuth } }>();

// KV-backed rate limiting — a fixed window per API key, since ingestion is
// machine-to-machine and can be high frequency (one heartbeat per
// connected user every 30-60s is a reasonable daemon interval).
ingestRoutes.use("*", async (c, next) => {
  const header = c.req.header("authorization") ?? "unknown";
  const keyId = header.slice(0, 24); // coarse bucket before full auth runs; real auth still required per-route
  const { allowed } = await rateLimitHit(c.env, `ratelimit:ingest:${keyId}`, 600, 60);
  if (!allowed) return c.json({ error: { code: "TOO_MANY_REQUESTS", message: "Ingestion rate limit exceeded" } }, 429);
  await next();
});

async function resolveUser(env: Env, input: { userId?: string; username?: string }) {
  const db = getDb(env);
  if (input.userId) return db.select().from(vpnUsers).where(eq(vpnUsers.id, input.userId)).get();
  if (input.username) return db.select().from(vpnUsers).where(eq(vpnUsers.username, input.username)).get();
  return null;
}

const trafficSchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  uploadBytes: z.number(),
  downloadBytes: z.number(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  requestCount: z.number().int().nonnegative().optional(),
  isEstimated: z.boolean().default(true),
  idempotencyKey: z.string().max(128).optional(),
});

ingestRoutes.post("/traffic", requireApiKey("TRAFFIC_INGEST", "FULL_INGEST"), async (c) => {
  const body = await c.req.json();
  const parsed = trafficSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid traffic report");
  const input = parsed.data;

  const user = await resolveUser(c.env, input);
  if (!user) return notFound(c, "Unknown userId/username");

  const apiKey = c.get("apiKey");
  const traffic = await recordTraffic(c.env, {
    userId: user.id,
    uploadBytes: input.uploadBytes,
    downloadBytes: input.downloadBytes,
    periodStart: new Date(input.periodStart),
    periodEnd: new Date(input.periodEnd),
    isEstimated: input.isEstimated,
    sourceApiKeyId: apiKey.id,
    idempotencyKey: input.idempotencyKey,
  });

  let requests;
  if (input.requestCount !== undefined) {
    requests = await recordRequests(c.env, {
      userId: user.id,
      count: input.requestCount,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:requests` : undefined,
    });
  }

  return c.json({ traffic, requests }, traffic.created ? 201 : 200);
});

const heartbeatSchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  serverId: z.string().optional(),
  endpointId: z.string().optional(),
  clientIp: z.string().optional(),
  connectionSessionId: z.string().optional(),
});

ingestRoutes.post("/heartbeat", requireApiKey("PRESENCE_INGEST", "FULL_INGEST"), async (c) => {
  const body = await c.req.json();
  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid heartbeat");
  const input = parsed.data;

  const user = await resolveUser(c.env, input);
  if (!user) return notFound(c, "Unknown userId/username");

  const result = await heartbeat(c.env, {
    userId: user.id,
    serverId: input.serverId,
    endpointId: input.endpointId,
    clientIp: input.clientIp ?? c.req.header("cf-connecting-ip"),
    connectionSessionId: input.connectionSessionId,
  });
  return c.json(result);
});

const endSessionSchema = z.object({ connectionSessionId: z.string().min(1), reason: z.string().max(64).default("client_disconnect") });

ingestRoutes.post("/session/end", requireApiKey("PRESENCE_INGEST", "FULL_INGEST"), async (c) => {
  const body = await c.req.json();
  const parsed = endSessionSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid request");
  await endSession(c.env, parsed.data.connectionSessionId, parsed.data.reason);
  return c.json({ ok: true });
});

ingestRoutes.get("/ping", requireApiKey(), async (c) => {
  return c.json({ ok: true, scopes: c.get("apiKey").scopes });
});
