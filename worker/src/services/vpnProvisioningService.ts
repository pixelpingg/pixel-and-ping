import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { vpnUsers } from "../db/schema";
import { selectVpnProvider } from "../providers";
import { createNotification } from "./notificationService";
import type { Env } from "../lib/env";

export async function attemptProvisioning(env: Env, userId: string) {
  const db = getDb(env);
  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, userId)).get();
  if (!user || !user.serverId) return null;

  await db.update(vpnUsers).set({ provisioningStatus: "PENDING", provisioningMessage: null }).where(eq(vpnUsers.id, userId));

  const provider = selectVpnProvider(env);
  const result = await provider.provisionUser({ userId: user.id, serverId: user.serverId, protocol: user.protocol, port: user.port, uuid: user.uuid });

  await db.update(vpnUsers).set({ provisioningStatus: result.status, provisioningMessage: result.message }).where(eq(vpnUsers.id, userId));

  if (result.status === "FAILED") {
    await createNotification(env, { level: "ERROR", title: "VPN provisioning failed", message: `${user.username}: ${result.message}` });
  }
  return result;
}

export async function attemptDeprovisioning(env: Env, userId: string) {
  const db = getDb(env);
  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, userId)).get();
  if (!user || !user.serverId) return null;

  const provider = selectVpnProvider(env);
  const result = await provider.deprovisionUser({ userId: user.id, serverId: user.serverId });
  await db.update(vpnUsers).set({ provisioningStatus: "DEPROVISIONED", provisioningMessage: result.message }).where(eq(vpnUsers.id, userId));
  return result;
}
