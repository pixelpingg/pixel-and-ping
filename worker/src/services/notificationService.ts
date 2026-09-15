import { getDb } from "../lib/db";
import { notifications } from "../db/schema";
import { newId } from "../lib/crypto";
import type { Env } from "../lib/env";

export async function createNotification(
  env: Env,
  input: { level: "INFO" | "WARNING" | "ERROR" | "CRITICAL"; title: string; message: string; metadata?: Record<string, unknown> }
) {
  const db = getDb(env);
  await db.insert(notifications).values({
    id: newId(),
    level: input.level,
    title: input.title,
    message: input.message,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt: new Date(),
  });
}
