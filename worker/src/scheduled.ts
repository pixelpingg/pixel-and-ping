import { checkAllEndpoints } from "./services/healthCheckService";
import { evaluateFailoverForAllServers } from "./services/failoverService";
import { cleanupStaleSessions } from "./services/presenceService";
import { sweepExpiredUsers } from "./services/expiryService";
import { syncAllCloudflareAccounts } from "./services/cloudflareService";
import { getDb } from "./lib/db";
import { failoverSettings } from "./db/schema";
import type { Env } from "./lib/env";

/**
 * Runs on Cloudflare's Cron Trigger schedule (wrangler.toml [triggers]
 * crons — every 5 minutes by default). This replaces the Node backend's
 * three setInterval loops (health checks every 30s, Cloudflare sync every
 * 5min, presence cleanup every 30s) with a single scheduled invocation
 * per period, since Workers cannot run a persistent background loop.
 *
 * Trade-off, stated plainly: a 5-minute cron means health checks,
 * presence timeouts, and failover reactions are only as fresh as the
 * last cron tick, not truly real-time the way a 30-second setInterval
 * was. Cloudflare's minimum Cron Trigger granularity is 1 minute; set
 * PRESENCE_TIMEOUT_SEC comfortably above your cron interval so sessions
 * aren't marked stale before a heartbeat had a chance to land, and lower
 * the cron interval in wrangler.toml if your deployment needs tighter
 * reaction time (down to once per minute).
 */
export async function runScheduledJobs(env: Env) {
  const results: Record<string, unknown> = {};

  try {
    results.healthChecks = (await checkAllEndpoints(env)).length;
    const db = getDb(env);
    const settings = await db.select().from(failoverSettings).limit(1).get();
    if (settings?.enabled) {
      results.failoverEvaluations = (await evaluateFailoverForAllServers(env)).length;
    }
  } catch (err) {
    console.error("Scheduled health-check/failover cycle failed", err instanceof Error ? err.message : err);
  }

  try {
    results.presenceCleanup = await cleanupStaleSessions(env, Number(env.PRESENCE_TIMEOUT_SEC));
  } catch (err) {
    console.error("Scheduled presence cleanup failed", err instanceof Error ? err.message : err);
  }

  try {
    results.expirySweep = await sweepExpiredUsers(env);
  } catch (err) {
    console.error("Scheduled expiry sweep failed", err instanceof Error ? err.message : err);
  }

  try {
    await syncAllCloudflareAccounts(env);
    results.cloudflareSync = "ok";
  } catch (err) {
    console.error("Scheduled Cloudflare sync failed", err instanceof Error ? err.message : err);
  }

  console.log(JSON.stringify({ scheduledRun: results }));
}
