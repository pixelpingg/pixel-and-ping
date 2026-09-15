import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { cloudflareAccounts, cloudflareUsageSnapshots } from "../db/schema";
import { decryptSecret, encryptSecret, newId } from "../lib/crypto";
import type { Env } from "../lib/env";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CfListResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

export class CloudflareApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Identical contract to backend/src/services/cloudflareService.ts's
 * cfFetch — retries with backoff on 429/5xx (respecting Retry-After),
 * fails fast on 401/403. The Workers runtime's native `fetch` is used
 * directly; no polyfill or Node http client needed here, which is one of
 * the genuine advantages of running this on Workers instead of a VPS —
 * outbound HTTPS to Cloudflare's API is exactly what Workers is built for.
 */
async function cfFetch<T>(token: string, path: string, init?: RequestInit, attempt = 1): Promise<T> {
  const maxAttempts = 3;
  const res = await fetch(`${CF_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (res.status === 401 || res.status === 403) {
    throw new CloudflareApiError(res.status, "Cloudflare rejected the API token (unauthorized). Check the token's permissions.");
  }

  if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
    const retryAfter = res.headers.get("retry-after");
    const delayMs = retryAfter ? Number(retryAfter) * 1000 : 300 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delayMs));
    return cfFetch<T>(token, path, init, attempt + 1);
  }
  if (res.status === 429) throw new CloudflareApiError(429, "Cloudflare API rate limit reached. Try again shortly.");
  if (res.status >= 500) throw new CloudflareApiError(502, "Cloudflare API is currently unavailable.");

  const body = (await res.json()) as CfListResponse<T>;
  if (!body.success) {
    throw new CloudflareApiError(502, `Cloudflare API error: ${body.errors?.[0]?.message ?? "Unknown error"}`);
  }
  return body.result;
}

export async function verifyToken(apiToken: string): Promise<{ status: string }> {
  return cfFetch<{ status: string }>(apiToken, "/user/tokens/verify");
}

async function getTokenFromAccount(account: { encryptedToken: string; tokenIv: string; tokenAuthTag: string }, encryptionKey: string): Promise<string> {
  return decryptSecret({ ciphertext: account.encryptedToken, iv: account.tokenIv, authTag: account.tokenAuthTag }, encryptionKey);
}

export async function addCloudflareAccount(env: Env, input: { name: string; accountId: string; apiToken: string }) {
  await verifyToken(input.apiToken); // never save an unverified token
  const encrypted = await encryptSecret(input.apiToken, env.ENCRYPTION_KEY);

  const db = getDb(env);
  const now = new Date();
  const row = {
    id: newId(),
    name: input.name,
    accountId: input.accountId,
    encryptedToken: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    isActive: true,
    status: "HEALTHY",
    lastSyncAt: now,
    lastSyncError: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(cloudflareAccounts).values(row);
  return row;
}

/**
 * Auto-provisions the operator's own Cloudflare account as a
 * CloudflareAccount row, straight from the CF_ACCOUNT_ID/CF_API_TOKEN
 * deploy-time secrets — no "Add Cloudflare Account" step in the panel
 * UI at all. A deployment only ever runs under one Cloudflare account
 * (the operator's own), so there's nothing to "add"; this just makes
 * that account visible to the same zones/DNS-verification code every
 * other part of this panel already uses, unchanged. Idempotent and
 * cheap (one indexed SELECT) — safe to call on every relevant request.
 */
export async function ensureSelfAccount(env: Env): Promise<void> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return; // not configured — self-usage widget reports "not configured"
  const db = getDb(env);
  const existing = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.accountId, env.CF_ACCOUNT_ID)).get();
  if (existing) return;
  try {
    await addCloudflareAccount(env, { name: "My Cloudflare account", accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
  } catch {
    // Bad/misconfigured token — don't create a broken row for it; the
    // next request retries, and callers see "not configured" rather
    // than a fake account stuck in an UNHEALTHY state.
  }
}

export interface SelfUsage {
  configured: boolean;
  requestsToday?: number;
  errorsToday?: number;
  dailyLimit?: number;
  percentUsed?: number;
}

/**
 * Today's Workers request count for the operator's own account, via
 * Cloudflare's GraphQL Analytics API (the documented, correct way to
 * get this — there is no simpler REST "requests today" endpoint).
 * `dailyLimit` is NOT something Cloudflare's API exposes anywhere
 * (there's no "what's my plan's quota" endpoint) — it's the
 * CF_DAILY_REQUEST_LIMIT setting the operator configures themselves.
 */
export async function getSelfUsage(env: Env): Promise<SelfUsage> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return { configured: false };

  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // accountTag/date range are Worker-generated (env var + Date.toISOString()),
  // never user input, so inlining them avoids GraphQL variable-type
  // ambiguity across Cloudflare's own docs (some show `string`, others
  // `String!`) rather than risking a mismatch.
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${env.CF_ACCOUNT_ID}" }) {
        workersInvocationsAdaptive(
          limit: 10000
          filter: { datetime_geq: "${startOfDay.toISOString()}", datetime_leq: "${now.toISOString()}" }
        ) {
          sum { requests errors }
        }
      }
    }
  }`;

  const res = await fetch(`${CF_API_BASE}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await res.json()) as { data?: any; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length) {
    if (res.status === 401 || res.status === 403) throw new CloudflareApiError(res.status, "Cloudflare rejected CF_API_TOKEN (unauthorized). Check the token's permissions.");
    throw new CloudflareApiError(res.status || 502, `Cloudflare GraphQL error: ${body.errors?.[0]?.message ?? res.statusText}`);
  }

  const rows: { sum?: { requests?: number; errors?: number } }[] = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  const requestsToday = rows.reduce((sum, r) => sum + (r.sum?.requests ?? 0), 0);
  const errorsToday = rows.reduce((sum, r) => sum + (r.sum?.errors ?? 0), 0);
  const dailyLimit = Number(env.CF_DAILY_REQUEST_LIMIT) || 100000;
  return { configured: true, requestsToday, errorsToday, dailyLimit, percentUsed: Math.min(100, Math.round((requestsToday / dailyLimit) * 100)) };
}

export interface CfZoneSummary {
  id: string;
  name: string;
  status: string;
}

export async function listZones(env: Env, accountDbId: string): Promise<CfZoneSummary[]> {
  const db = getDb(env);
  const account = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, accountDbId)).get();
  if (!account) throw new Error("Cloudflare account not found");
  const token = await getTokenFromAccount(account, env.ENCRYPTION_KEY);
  const zones = await cfFetch<CfZoneSummary[]>(token, `/zones?account.id=${encodeURIComponent(account.accountId)}&per_page=50`);
  return zones.map((z) => ({ id: z.id, name: z.name, status: z.status }));
}

export async function verifyZoneOwnership(env: Env, accountDbId: string, zoneId: string): Promise<boolean> {
  const zones = await listZones(env, accountDbId);
  return zones.some((z) => z.id === zoneId);
}

export interface CfWorkerSummary {
  id: string;
  createdOn?: string;
  modifiedOn?: string;
}

// Workers usage requires the Workers Scripts API, which is only available
// on tokens with the relevant scope. If the token lacks that scope, this
// returns null and the caller surfaces "Unavailable from Cloudflare API"
// rather than fabricate data — same contract as
// backend/src/services/cloudflareService.ts's listWorkers.
export async function listWorkers(env: Env, accountDbId: string): Promise<CfWorkerSummary[] | null> {
  const db = getDb(env);
  const account = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, accountDbId)).get();
  if (!account) throw new Error("Cloudflare account not found");
  const token = await getTokenFromAccount(account, env.ENCRYPTION_KEY);
  try {
    const result = await cfFetch<any[]>(token, `/accounts/${account.accountId}/workers/scripts`);
    return result.map((w) => ({ id: w.id, createdOn: w.created_on, modifiedOn: w.modified_on }));
  } catch {
    return null;
  }
}

export interface CfDnsRecordSummary {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

export async function findDnsRecord(env: Env, accountDbId: string, zoneId: string, hostname: string): Promise<CfDnsRecordSummary | null> {
  const db = getDb(env);
  const account = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, accountDbId)).get();
  if (!account) throw new Error("Cloudflare account not found");
  const token = await getTokenFromAccount(account, env.ENCRYPTION_KEY);
  const records = await cfFetch<any[]>(token, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`);
  if (!records || records.length === 0) return null;
  const r = records[0];
  return { id: r.id, type: r.type, name: r.name, content: r.content, proxied: !!r.proxied };
}

export async function fetchZoneAnalytics(env: Env, accountDbId: string, zoneId: string, sinceISO: string, untilISO: string) {
  const db = getDb(env);
  const account = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, accountDbId)).get();
  if (!account) throw new Error("Cloudflare account not found");
  const token = await getTokenFromAccount(account, env.ENCRYPTION_KEY);

  const query = `
    query ZoneAnalytics($zoneTag: String!, $since: Time!, $until: Time!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequests1dGroups(limit: 31, filter: { date_geq: $since, date_leq: $until }) {
            sum { requests, bytes }
          }
        }
      }
    }`;

  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { zoneTag: zoneId, since: sinceISO, until: untilISO } }),
  });
  if (!res.ok) return null;
  const json = await res.json<any>();
  const groups = json?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
  if (!groups || groups.length === 0) return null;

  return groups.reduce(
    (acc: { requests: number; bandwidthBytes: number }, g: any) => {
      acc.requests += g.sum?.requests ?? 0;
      acc.bandwidthBytes += g.sum?.bytes ?? 0;
      return acc;
    },
    { requests: 0, bandwidthBytes: 0 }
  );
}

/**
 * Per-zone sync, run from the Cron Trigger (src/scheduled.ts) — the
 * Workers equivalent of the Node backend's setInterval-based scheduler.
 * Same honesty rules apply: a zone with no analytics available gets
 * dataAvailable=false, never a fabricated number.
 */
export async function syncAllCloudflareAccounts(env: Env) {
  const db = getDb(env);
  const accounts = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.isActive, true)).all();

  for (const account of accounts) {
    try {
      const token = await getTokenFromAccount(account, env.ENCRYPTION_KEY);
      await verifyToken(token);
      const zones = await listZones(env, account.id);

      for (const zone of zones) {
        try {
          const today = new Date();
          const since = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const until = today.toISOString().slice(0, 10);
          const analytics = await fetchZoneAnalytics(env, account.id, zone.id, since, until);

          await db.insert(cloudflareUsageSnapshots).values({
            id: newId(),
            accountId: account.id,
            zoneId: zone.id,
            zoneName: zone.name,
            requestsToday: analytics?.requests ?? null,
            bandwidthBytes: analytics?.bandwidthBytes ?? null,
            dataAvailable: !!analytics,
            source: analytics ? "Cloudflare GraphQL Analytics API" : "Unavailable from Cloudflare API",
            capturedAt: new Date(),
          });
        } catch {
          await db.insert(cloudflareUsageSnapshots).values({
            id: newId(),
            accountId: account.id,
            zoneId: zone.id,
            zoneName: zone.name,
            dataAvailable: false,
            source: "Unavailable from Cloudflare API",
            capturedAt: new Date(),
          });
        }
      }

      await db.update(cloudflareAccounts).set({ status: "HEALTHY", lastSyncAt: new Date(), lastSyncError: null }).where(eq(cloudflareAccounts.id, account.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      await db.update(cloudflareAccounts).set({ status: "UNHEALTHY", lastSyncError: message }).where(eq(cloudflareAccounts.id, account.id));
    }
  }
}
