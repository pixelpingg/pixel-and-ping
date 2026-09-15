import type { Env } from "./env";

/**
 * KV usage rules for this project (per README § Cloudflare-Native
 * Architecture): KV is a CACHE, never the source of truth for relational
 * data — that's D1, always. Every function here is read-through-cache
 * with a TTL; if KV is empty/expired/unavailable, the caller re-fetches
 * from the real source (D1 query or live Cloudflare API call) and the
 * result still works, just slightly slower. Nothing in this project ever
 * assumes KV has a value.
 *
 * Concrete uses in this codebase:
 *   - Cloudflare API responses (zone lists, token verification results)
 *     that are safe to serve slightly stale for a short TTL, to reduce
 *     redundant calls to Cloudflare's API and stay under its rate limits.
 *   - Per-IP login rate-limit counters (short TTL, self-expiring — KV's
 *     native TTL support is a good fit for this, better than a D1 row
 *     that would need its own cleanup job).
 *   - Recent health-check results, for endpoints hit very frequently by
 *     the IP Scanner UI, to avoid re-probing on every page load.
 */

const DEFAULT_TTL_SECONDS = 60;

export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.PIXELPING_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(env: Env, key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  await env.PIXELPING_KV.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
}

export async function cacheDelete(env: Env, key: string): Promise<void> {
  await env.PIXELPING_KV.delete(key);
}

/**
 * Simple fixed-window rate limiter backed by KV's atomic-ish put/get with
 * TTL. Not perfectly race-free under very high concurrency (KV is
 * eventually consistent), which is an acceptable tradeoff for login
 * throttling — D1 with a transaction would be exact but slower for this
 * high-frequency, low-stakes-if-slightly-off use case.
 */
export async function rateLimitHit(env: Env, key: string, max: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
  const current = (await cacheGet<number>(env, key)) ?? 0;
  if (current >= max) return { allowed: false, remaining: 0 };
  await cacheSet(env, key, current + 1, windowSeconds);
  return { allowed: true, remaining: max - current - 1 };
}
