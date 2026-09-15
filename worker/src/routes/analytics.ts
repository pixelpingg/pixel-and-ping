import { Hono } from "hono";
import { eq, isNotNull, inArray, desc } from "drizzle-orm";
import { getDb } from "../lib/db";
import { vpnUsers, servers, endpoints, cloudflareAccounts, cloudflareUsageSnapshots, trafficUsage, activityLogs, admins } from "../db/schema";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import type { Env } from "../lib/env";

export const analyticsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
analyticsRoutes.use("*", requireAuth);

// SUPER_ADMIN-only. Deliberately not reachable by ADMIN/VIEWER accounts
// (requireRole below returns 403, and the frontend never even renders a
// nav entry for it — see OwnerOverview.tsx) — this is the operator's own
// "what have I actually deployed" view, not something every admin who's
// been let into the panel should see.
analyticsRoutes.get("/owner-overview", requireRole("SUPER_ADMIN"), async (c) => {
  const db = getDb(c.env);

  const allServers = await db.select().from(servers).all();
  const allUsers = await db.select().from(vpnUsers).all();
  const trafficRows = await db.select().from(trafficUsage).all();
  const allAdmins = await db.select().from(admins).all();
  // "user.create" events, not the vpnUsers table itself, is the only
  // record of *who* created each account — vpnUsers has no
  // createdByAdminId column, and adding one would mean a migration
  // touching every existing row for a number that's already fully
  // reconstructable from the log this panel already keeps.
  const createEvents = await db.select().from(activityLogs).where(eq(activityLogs.action, "user.create")).all();

  const byAdmin = new Map<string, number>();
  for (const ev of createEvents) {
    if (!ev.adminId) continue;
    byAdmin.set(ev.adminId, (byAdmin.get(ev.adminId) ?? 0) + 1);
  }
  const adminById = new Map(allAdmins.map((a) => [a.id, a]));
  const usersCreatedByAdmin = [...byAdmin.entries()]
    .map(([adminId, count]) => ({ adminId, username: adminById.get(adminId)?.username ?? "(deleted admin)", count }))
    .sort((a, b) => b.count - a.count);

  const totalTrafficBytes = trafficRows.reduce((sum, r) => sum + r.uploadBytes + r.downloadBytes, 0);
  const byServer = allServers.map((s) => {
    const usersOnServer = allUsers.filter((u) => u.serverId === s.id);
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      totalUsers: usersOnServer.length,
      activeUsers: usersOnServer.filter((u) => u.status === "ACTIVE").length,
    };
  });

  return c.json({
    totalServers: allServers.length,
    totalUsersEverCreated: createEvents.length,
    totalUsersNow: allUsers.length,
    totalTrafficBytes,
    usersCreatedByAdmin,
    byServer,
  });
});

analyticsRoutes.get("/dashboard", async (c) => {
  const db = getDb(c.env);

  const allUsers = await db.select().from(vpnUsers).all();
  const allServers = await db.select().from(servers).all();
  const allCfAccounts = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.isActive, true)).all();
  const allEndpoints = await db.select().from(endpoints).all();
  const trafficRows = await db.select().from(trafficUsage).all();

  const zoneSnapshots = await db.select().from(cloudflareUsageSnapshots).where(isNotNull(cloudflareUsageSnapshots.zoneId)).orderBy(desc(cloudflareUsageSnapshots.capturedAt)).limit(200).all();
  const latestByZone = new Map<string, (typeof zoneSnapshots)[number]>();
  for (const s of zoneSnapshots) if (s.zoneId && !latestByZone.has(s.zoneId)) latestByZone.set(s.zoneId, s);
  const availableZones = [...latestByZone.values()].filter((s) => s.dataAvailable);

  const totalTrafficBytes = trafficRows.reduce((sum, r) => sum + r.uploadBytes + r.downloadBytes, 0);

  return c.json({
    totalUsers: allUsers.length,
    activeUsers: allUsers.filter((u) => u.status === "ACTIVE").length,
    onlineUsers: allUsers.filter((u) => u.isOnline).length,
    activeServers: allServers.filter((s) => s.isEnabled && s.status === "ONLINE").length,
    totalServers: allServers.length,
    cloudflareAccounts: allCfAccounts.length,
    healthyEndpoints: allEndpoints.filter((e) => ["EXCELLENT", "GOOD", "FAIR"].includes(e.health)).length,
    totalEndpoints: allEndpoints.length,
    totalTrafficBytes: String(totalTrafficBytes),
    dailyRequests: availableZones.length > 0 ? availableZones.reduce((sum, s) => sum + (s.requestsToday ?? 0), 0) : null,
    dailyRequestsAvailable: availableZones.length > 0,
  });
});

analyticsRoutes.get("/traffic-series", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(trafficUsage).limit(90).all();
  return c.json({ series: rows.map((r) => ({ date: r.periodStart, upload: r.uploadBytes, download: r.downloadBytes, isEstimated: r.isEstimated })) });
});

analyticsRoutes.get("/user-activity", async (c) => {
  const db = getDb(c.env);
  const allUsers = await db.select().from(vpnUsers).all();
  const byStatus = new Map<string, number>();
  for (const u of allUsers) byStatus.set(u.status, (byStatus.get(u.status) ?? 0) + 1);
  return c.json({
    byStatus: [...byStatus.entries()].map(([status, cnt]) => ({ status, count: cnt })),
    online: allUsers.filter((u) => u.isOnline).length,
    offline: allUsers.filter((u) => !u.isOnline).length,
  });
});

analyticsRoutes.get("/server-health", async (c) => {
  const db = getDb(c.env);
  const allServers = await db.select().from(servers).all();
  const result = await Promise.all(
    allServers.map(async (s) => {
      const eps = await db.select().from(endpoints).where(eq(endpoints.serverId, s.id)).all();
      const withLatency = eps.filter((e) => e.latencyMs !== null);
      const avgLatencyMs = withLatency.length ? Math.round(withLatency.reduce((sum, e) => sum + (e.latencyMs ?? 0), 0) / withLatency.length) : null;
      return { id: s.id, name: s.name, status: s.status, avgLatencyMs, endpointHealth: eps.map((e) => e.health) };
    })
  );
  return c.json({ servers: result });
});

analyticsRoutes.get("/cloudflare-usage", async (c) => {
  const db = getDb(c.env);
  const range = c.req.query("range") ?? "today";
  const windowDays = range === "30d" ? 30 : range === "7d" ? 7 : 1;

  const activeAccounts = await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.isActive, true)).all();
  if (activeAccounts.length === 0) return c.json({ available: false, reason: "No active Cloudflare accounts connected", zones: [], range });

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const accountIds = activeAccounts.map((a) => a.id);
  const recent = await db.select().from(cloudflareUsageSnapshots).where(inArray(cloudflareUsageSnapshots.accountId, accountIds)).all();
  const recentInWindow = recent.filter((s) => s.zoneId && s.capturedAt.getTime() >= since.getTime());

  if (recentInWindow.length === 0) return c.json({ available: false, reason: "No Cloudflare analytics have synced yet in this window", zones: [], range });

  const byZoneDay = new Map<string, (typeof recentInWindow)[number]>();
  for (const s of recentInWindow) {
    const day = s.capturedAt.toISOString().slice(0, 10);
    const key = `${s.zoneId}:${day}`;
    if (!byZoneDay.has(key)) byZoneDay.set(key, s);
  }
  const dayRows = [...byZoneDay.values()];

  const zoneNames = new Map<string, string>();
  for (const s of dayRows) if (s.zoneId && s.zoneName) zoneNames.set(s.zoneId, s.zoneName);

  const zoneTotals = new Map<string, { requests: number; bytes: number; anyAvailable: boolean; anyUnavailable: boolean; latest: Date; source: string }>();
  for (const s of dayRows) {
    if (!s.zoneId) continue;
    const existing = zoneTotals.get(s.zoneId) ?? { requests: 0, bytes: 0, anyAvailable: false, anyUnavailable: false, latest: s.capturedAt, source: s.source };
    if (s.dataAvailable) {
      existing.requests += s.requestsToday ?? 0;
      existing.bytes += s.bandwidthBytes ?? 0;
      existing.anyAvailable = true;
    } else {
      existing.anyUnavailable = true;
    }
    if (s.capturedAt > existing.latest) {
      existing.latest = s.capturedAt;
      existing.source = s.source;
    }
    zoneTotals.set(s.zoneId, existing);
  }

  const zones = [...zoneTotals.entries()].map(([zoneId, v]) => ({
    zoneId,
    zoneName: zoneNames.get(zoneId) ?? zoneId,
    requestsToday: v.anyAvailable ? v.requests : null,
    bandwidthBytes: v.anyAvailable ? String(v.bytes) : null,
    dataAvailable: v.anyAvailable,
    partiallyAvailable: v.anyAvailable && v.anyUnavailable,
    source: v.anyAvailable ? v.source : "Unavailable from Cloudflare API",
    capturedAt: v.latest,
  }));

  const availableZones = zones.filter((z) => z.dataAvailable);
  return c.json({
    available: availableZones.length > 0,
    range,
    totalRequestsToday: availableZones.reduce((sum, z) => sum + (z.requestsToday ?? 0), 0),
    totalBandwidthBytes: String(availableZones.reduce((sum, z) => sum + Number(z.bandwidthBytes ?? 0), 0)),
    zones,
  });
});
