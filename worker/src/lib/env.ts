// Cloudflare Worker environment bindings — the Workers equivalent of
// backend/src/lib/env.ts. Bindings come from wrangler.toml (D1/KV/vars)
// and `wrangler secret put` (JWT_SECRET, ENCRYPTION_KEY) — never hardcoded,
// never committed.

export interface Env {
  // D1 — primary relational database.
  DB: D1Database;
  // KV — cache / short-lived state only. See lib/kv.ts for usage rules.
  PIXELPING_KV: KVNamespace;
  // Static assets binding (frontend/dist) — see wrangler.toml [assets].
  // Not referenced directly in route code today (the platform's
  // run_worker_first/not_found_handling config routes requests
  // automatically); present here for completeness and any future
  // explicit `env.ASSETS.fetch()` fallback.
  ASSETS: Fetcher;

  // Secrets (wrangler secret put <NAME>) — never logged, never returned
  // to the frontend.
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  // Your own Cloudflare account's API token — set once at deploy time
  // via `wrangler secret put CF_API_TOKEN`. Powers the self-usage widget
  // and zone/DNS lookups (see cloudflareService.ts's ensureSelfAccount).
  // Optional: leave unset and those features simply report "not configured".
  CF_API_TOKEN?: string;

  // Plain vars (wrangler.toml [vars], safe to commit).
  FRONTEND_ORIGIN: string;
  PRESENCE_TIMEOUT_SEC: string;
  VPN_PROVIDER: string;
  // Your Cloudflare account ID (find it on the Workers & Pages Overview
  // page, or any zone's dashboard sidebar) — paired with CF_API_TOKEN
  // above. Leave blank if you don't want the self-usage widget.
  CF_ACCOUNT_ID: string;
  // Requests/day your Cloudflare plan actually includes — Cloudflare's
  // API has no endpoint that reports this, so it's a plain setting, not
  // something auto-detected. Workers Free = 100000; raise it if you're
  // on a paid plan with a larger included quota.
  CF_DAILY_REQUEST_LIMIT: string;
  ADMIN_TELEGRAM_ID: string;
  PUBLIC_BASE_URL: string;
}
