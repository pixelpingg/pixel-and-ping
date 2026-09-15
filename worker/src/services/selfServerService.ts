// Auto-provisions the "self" Server/Endpoint row: this Worker's own
// public domain, wherever it ends up deployed (workers.dev subdomain or
// a custom domain attached later), IS the relay (see
// services/relayService.ts — VPN_PROVIDER="worker-relay" already means
// "no VPS, this Worker itself is the node"). Before this, an admin still
// had to open Servers → Add Server and manually type that same domain
// into a form by hand, which is redundant: the Worker already knows its
// own hostname from every incoming request. This makes that step
// automatic instead of removing the Server/Endpoint concept — failover,
// health checks, multi-domain (Cloudflare Worker custom domains) setups
// etc. all still work exactly as before, they just start from a
// pre-populated node instead of an empty list.
//
// Same lazy-bootstrap shape as the first-admin-on-first-login flow in
// routes/auth.ts: no deploy hook, no migration, no manual step — the
// first request that ever reaches the Worker on a given host creates
// (or relocates) this row. Fixed, well-known IDs ("self-worker" /
// "self-worker-endpoint") make this idempotent via upsert — no schema
// change needed, since `servers.id`/`endpoints.id` are already plain
// text primary keys, not constrained to newId()'s format.

import { getDb } from "../lib/db";
import { servers, endpoints } from "../db/schema";
import { sanitizeHost } from "../lib/host";
import { cacheGet, cacheSet } from "../lib/kv";
import type { Env } from "../lib/env";

export const SELF_SERVER_ID = "self-worker";
export const SELF_ENDPOINT_ID = "self-worker-endpoint";

const KV_KEY = "self-server:host";
// Re-check D1 at most this often per host — KV is the fast path so a
// hot Worker isn't doing a D1 read+upsert on every single request.
const RECHECK_TTL_SECONDS = 300;

/**
 * Ensures a Server (id: SELF_SERVER_ID) + Endpoint (id: SELF_ENDPOINT_ID)
 * row exists in D1 with host == the domain this request actually arrived
 * on. Safe to call on every request: the KV-cached fast path is a single
 * cache read once the host is known and unchanged; D1 is only touched
 * the first time a host is seen (fresh deploy, or a custom domain added/
 * changed after the fact).
 */
export async function ensureSelfServer(env: Env, request: Request): Promise<void> {
  const rawHost = request.headers.get("host");
  if (!rawHost) return; // nothing to bootstrap from (shouldn't happen for a real HTTP request)
  const host = sanitizeHost(rawHost);
  if (!host) return;

  const cachedHost = await cacheGet<string>(env, KV_KEY);
  if (cachedHost === host) return; // already provisioned for this host recently

  const db = getDb(env);
  const now = new Date();

  await db
    .insert(servers)
    .values({
      id: SELF_SERVER_ID,
      name: "این Worker (خودکار)",
      host,
      port: 443,
      protocol: "vless",
      location: "Cloudflare Worker — built-in relay",
      status: "ONLINE",
      isEnabled: true,
      cloudflareAccountId: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: servers.id,
      set: { host, status: "ONLINE", isEnabled: true, updatedAt: now },
    });

  await db
    .insert(endpoints)
    .values({
      id: SELF_ENDPOINT_ID,
      serverId: SELF_SERVER_ID,
      label: "Primary",
      host,
      port: 443,
      weight: 100,
      isPrimary: true,
      health: "UNKNOWN",
      score: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: endpoints.id,
      set: { host, updatedAt: now },
    });

  await cacheSet(env, KV_KEY, host, RECHECK_TTL_SECONDS);
}

/** True if the given server id is the auto-provisioned self server. */
export function isSelfServerId(id: string | null | undefined): boolean {
  return id === SELF_SERVER_ID;
}

/**
 * Returns the id to use when a caller (e.g. user creation) didn't pick a
 * server explicitly — the self server, once ensured to exist for the
 * current request's host.
 */
export async function ensureAndGetDefaultServerId(env: Env, request: Request): Promise<string> {
  await ensureSelfServer(env, request);
  return SELF_SERVER_ID;
}
