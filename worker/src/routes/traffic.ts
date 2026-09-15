import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../lib/db";
import { trafficUsage, vpnUsers } from "../db/schema";
import { requireAuth, type AuthPayload } from "../middleware/auth";
import type { Env } from "../lib/env";

export const trafficRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
trafficRoutes.use("*", requireAuth);

trafficRoutes.get("/summary", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(trafficUsage).limit(500).all();
  const totalUpload = rows.reduce((sum, r) => sum + r.uploadBytes, 0);
  const totalDownload = rows.reduce((sum, r) => sum + r.downloadBytes, 0);
  return c.json({
    totalUploadBytes: String(totalUpload),
    totalDownloadBytes: String(totalDownload),
    totalBytes: String(totalUpload + totalDownload),
    isEstimated: rows.some((r) => r.isEstimated),
    sampleSize: rows.length,
  });
});

trafficRoutes.get("/user/:userId", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(trafficUsage).where(eq(trafficUsage.userId, c.req.param("userId"))).limit(30).all();
  return c.json({ usage: rows });
});

trafficRoutes.get("/server/:serverId", async (c) => {
  const db = getDb(c.env);
  const users = await db.select().from(vpnUsers).where(eq(vpnUsers.serverId, c.req.param("serverId"))).all();
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return c.json({ totalUploadBytes: "0", totalDownloadBytes: "0", isEstimated: false });
  const rows = await db.select().from(trafficUsage).where(inArray(trafficUsage.userId, userIds)).limit(200).all();
  const totalUpload = rows.reduce((sum, r) => sum + r.uploadBytes, 0);
  const totalDownload = rows.reduce((sum, r) => sum + r.downloadBytes, 0);
  return c.json({ totalUploadBytes: String(totalUpload), totalDownloadBytes: String(totalDownload), isEstimated: rows.some((r) => r.isEstimated) });
});
