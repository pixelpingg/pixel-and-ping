import { Hono } from "hono";
import type { Env } from "../lib/env";
import { handleTelegramUpdate, verifyTelegramSecret } from "../services/telegramBotService";

export const telegramRoutes = new Hono<{ Bindings: Env }>();

telegramRoutes.post("/webhook", async (c) => {
  if (!(await verifyTelegramSecret(c.req.raw, c.env))) return c.json({ ok: false }, 401);
  const update = await c.req.json().catch(() => null);
  if (!update || typeof update !== "object") return c.json({ ok: false }, 400);
  c.executionCtx.waitUntil(handleTelegramUpdate(c.env, update as any).catch((err) => console.error("telegram update failed", err instanceof Error ? err.message : String(err))));
  return c.json({ ok: true });
});
