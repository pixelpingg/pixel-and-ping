import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/env";

import { authRoutes } from "./routes/auth";
import { usersRoutes } from "./routes/users";
import { serversRoutes } from "./routes/servers";
import { endpointsRoutes } from "./routes/endpoints";
import { cloudflareRoutes } from "./routes/cloudflare";
import { portsRoutes } from "./routes/ports";
import { configsRoutes } from "./routes/configs";
import { trafficRoutes } from "./routes/traffic";
import { analyticsRoutes } from "./routes/analytics";
import { healthRoutes } from "./routes/health";
import { failoverRoutes } from "./routes/failover";
import { logsRoutes } from "./routes/logs";
import { notificationsRoutes } from "./routes/notifications";
import { settingsRoutes } from "./routes/settings";
import { apiKeysRoutes } from "./routes/apiKeys";
import { ingestRoutes } from "./routes/ingest";
import { frontIpsRoutes } from "./routes/frontIps";
import { telegramRoutes } from "./routes/telegram";

import { runScheduledJobs } from "./scheduled";
import { handleRelayConnection } from "./services/relayService";
import { ensureTelegramWebhook } from "./services/telegramBotService";
import { ensureSelfServer } from "./services/selfServerService";

const app = new Hono<{ Bindings: Env }>();

// Auto-provision the "self" Server/Endpoint (this Worker's own domain,
// whatever it is) before anything else runs — see
// services/selfServerService.ts. No manual "Add Server" step needed:
// the first request on a given host bootstraps it, exactly like the
// first-admin-on-first-login flow in routes/auth.ts. Cheap after the
// first hit (KV-cached), so safe to run unconditionally here.
app.use("*", async (c, next) => {
  await ensureSelfServer(c.env, c.req.raw).catch((err) => console.error(JSON.stringify({ error: "ensureSelfServer failed", message: err instanceof Error ? err.message : String(err) })));
  await next();
});

// Register the Telegram webhook on real traffic too, not just the 5-minute
// Cron Trigger (scheduled() below) — otherwise a fresh deploy sits with no
// webhook registered until the next cron tick fires (or forever, if crons
// are ever misconfigured/disabled on the account). KV-marker-cached inside
// ensureTelegramWebhook itself, so this is a no-op read after the first hit.
app.use("*", async (c, next) => {
  c.executionCtx.waitUntil(
    ensureTelegramWebhook(c.env, c.env.PUBLIC_BASE_URL).catch((err) =>
      console.error(JSON.stringify({ error: "ensureTelegramWebhook failed", message: err instanceof Error ? err.message : String(err) })),
    ),
  );
  await next();
});

// CORS: locked to the configured frontend origin, credentials allowed so
// the httpOnly session cookie round-trips — same policy as the Node
// backend's `cors({ origin: FRONTEND_ORIGIN, credentials: true })`.
app.use("*", async (c, next) => {
  const middleware = cors({
    origin: c.env.FRONTEND_ORIGIN,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  return middleware(c, next);
});

// Structured logging without secrets — mirrors the Node backend's
// winston logger contract (never logs tokens/passwords/cookies), just
// using console.log since Workers' `wrangler tail`/dashboard captures
// stdout directly; no separate log transport needed on this runtime.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(JSON.stringify({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start }));
});

app.onError((err, c) => {
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), path: c.req.path }));
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }, 500);
});

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: `Route ${c.req.path} not found` } }, 404));

app.get("/api/health", (c) => c.json({ ok: true, version: "1.1.1", runtime: "cloudflare-workers" }));

app.route("/api/auth", authRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/servers", serversRoutes);
app.route("/api/endpoints", endpointsRoutes);
app.route("/api/cloudflare", cloudflareRoutes);
app.route("/api/ports", portsRoutes);
app.route("/api/configs", configsRoutes);
app.route("/api/traffic", trafficRoutes);
app.route("/api/analytics", analyticsRoutes);
app.route("/api/health-checks", healthRoutes);
app.route("/api/failover", failoverRoutes);
app.route("/api/logs", logsRoutes);
app.route("/api/notifications", notificationsRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/api-keys", apiKeysRoutes);
app.route("/api/ingest", ingestRoutes);
app.route("/api/front-ips", frontIpsRoutes);
app.route("/api/telegram", telegramRoutes);

export default {
  /**
   * The relay's WebSocket upgrade response carries a live `webSocket`
   * handoff (status 101) that must reach the client completely
   * untouched — Hono's CORS/logging middleware chain exists to add
   * headers to normal JSON responses and has no reason to run over a
   * protocol handoff it doesn't understand, so these two paths are
   * dispatched directly here, before `app.fetch` and all of its
   * middleware, rather than registered as Hono routes.
   */
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/relay/vless") return handleRelayConnection(request, env, "vless");
    if (url.pathname === "/api/relay/trojan") return handleRelayConnection(request, env, "trojan");
    return app.fetch(request, env, ctx);
  },

  /**
   * Cloudflare Cron Trigger handler — the Workers replacement for the
   * Node backend's setInterval-based scheduler
   * (backend/src/services/scheduler.ts). Workers have no persistent
   * process to run setInterval in; wrangler.toml's [triggers] crons
   * entry invokes this on a fixed schedule instead. See scheduled.ts.
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledJobs(env));
    ctx.waitUntil(ensureTelegramWebhook(env, env.PUBLIC_BASE_URL).catch((err) => console.error("Telegram webhook setup failed", err instanceof Error ? err.message : String(err))));
  },
};
