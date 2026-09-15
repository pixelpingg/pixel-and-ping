import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { trafficUsage, requestUsage, vpnUsers } from "../db/schema";
import { newId } from "../lib/crypto";
import { createNotification } from "./notificationService";
import type { Env } from "../lib/env";

export interface TrafficReportInput {
  userId: string;
  uploadBytes: number;
  downloadBytes: number;
  periodStart: Date;
  periodEnd: Date;
  isEstimated: boolean;
  sourceApiKeyId?: string;
  idempotencyKey?: string;
}

export interface RequestReportInput {
  userId: string;
  count: number;
  periodStart: Date;
  periodEnd: Date;
  idempotencyKey?: string;
}

/**
 * Real ingestion sink — same idempotency-key + auto-suspend contract as
 * backend/src/providers/databaseTrafficProvider.ts. Only ever called from
 * an authenticated POST /api/ingest/traffic request; nothing here
 * generates a number on its own.
 */
export async function recordTraffic(env: Env, input: TrafficReportInput): Promise<{ created: boolean; id: string }> {
  const db = getDb(env);
  if (input.idempotencyKey) {
    const existing = await db.select().from(trafficUsage).where(eq(trafficUsage.idempotencyKey, input.idempotencyKey)).get();
    if (existing) return { created: false, id: existing.id };
  }

  const id = newId();
  await db.insert(trafficUsage).values({
    id,
    userId: input.userId,
    uploadBytes: input.uploadBytes,
    downloadBytes: input.downloadBytes,
    isEstimated: input.isEstimated,
    sourceApiKeyId: input.sourceApiKeyId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    createdAt: new Date(),
  });

  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, input.userId)).get();
  if (user?.trafficLimitBytes) {
    const allRows = await db.select().from(trafficUsage).where(eq(trafficUsage.userId, input.userId)).all();
    const total = allRows.reduce((sum, r) => sum + r.uploadBytes + r.downloadBytes, 0);
    if (total >= user.trafficLimitBytes && user.status === "ACTIVE") {
      await db.update(vpnUsers).set({ status: "SUSPENDED" }).where(eq(vpnUsers.id, user.id));
      await createNotification(env, { level: "WARNING", title: "Traffic limit reached", message: `${user.username} was automatically suspended after exceeding their traffic limit.` });
    }
  }

  return { created: true, id };
}

export async function recordRequests(env: Env, input: RequestReportInput): Promise<{ created: boolean; id: string }> {
  const db = getDb(env);
  if (input.idempotencyKey) {
    const existing = await db.select().from(requestUsage).where(eq(requestUsage.idempotencyKey, input.idempotencyKey)).get();
    if (existing) return { created: false, id: existing.id };
  }

  const id = newId();
  await db.insert(requestUsage).values({ id, userId: input.userId, count: input.count, idempotencyKey: input.idempotencyKey ?? null, periodStart: input.periodStart, periodEnd: input.periodEnd, createdAt: new Date() });

  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, input.userId)).get();
  if (user?.requestLimit) {
    const allRows = await db.select().from(requestUsage).where(eq(requestUsage.userId, input.userId)).all();
    const total = allRows.reduce((sum, r) => sum + r.count, 0);
    if (total >= user.requestLimit && user.status === "ACTIVE") {
      await db.update(vpnUsers).set({ status: "SUSPENDED" }).where(eq(vpnUsers.id, user.id));
      await createNotification(env, { level: "WARNING", title: "Request limit reached", message: `${user.username} was automatically suspended after exceeding their request limit.` });
    }
  }

  return { created: true, id };
}
