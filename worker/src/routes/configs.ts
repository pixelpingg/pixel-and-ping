import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../lib/db";
import { configurations } from "../db/schema";
import { generateConfiguration, revokeConfiguration, ConfigGenerationError } from "../services/configService";
import { requireAuth, requireRole, type AuthPayload } from "../middleware/auth";
import { logActivity } from "../services/activityLogService";
import { badRequest } from "../lib/response";
import type { Env } from "../lib/env";

export const configsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthPayload } }>();
configsRoutes.use("*", requireAuth);

configsRoutes.get("/user/:userId", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(configurations).where(eq(configurations.userId, c.req.param("userId")!)).orderBy(desc(configurations.createdAt)).all();
  return c.json({ configurations: rows });
});

const generateOptionsSchema = z.object({
  cloudflareAccountId: z.string().optional(),
  cloudflareZoneId: z.string().optional(),
  hostname: z.string().optional(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
  frontIps: z.array(z.string().min(1)).optional(),
});

configsRoutes.post("/user/:userId/generate", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json().catch(() => ({}));
  const parsed = generateOptionsSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid options");

  try {
    const generated = await generateConfiguration(c.env, c.req.param("userId")!, parsed.data);
    await logActivity(c.env, { adminId: auth.adminId, action: "config.generate", targetType: "Configuration", targetId: generated.primary.id });
    return c.json({ configuration: generated.primary, configurations: generated.all }, 201);
  } catch (err) {
    const message = err instanceof ConfigGenerationError ? err.message : "Unable to generate configuration";
    return badRequest(c, message);
  }
});

configsRoutes.post("/:id/revoke", requireRole("ADMIN"), async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id")!;
  const configuration = await revokeConfiguration(c.env, id);
  await logActivity(c.env, { adminId: auth.adminId, action: "config.revoke", targetType: "Configuration", targetId: id });
  return c.json({ configuration });
});
