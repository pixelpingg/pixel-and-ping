import { getDb } from "../lib/db";
import { activityLogs } from "../db/schema";
import { newId } from "../lib/crypto";
import type { Env } from "../lib/env";

export async function logActivity(
  env: Env,
  input: { adminId?: string; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown>; ipAddress?: string }
) {
  const db = getDb(env);
  await db.insert(activityLogs).values({
    id: newId(),
    adminId: input.adminId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    ipAddress: input.ipAddress ?? null,
    createdAt: new Date(),
  });
}
