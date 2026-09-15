import type { Context } from "hono";

// Small helpers to keep every route's error shape identical to the
// Node/Express version's { error: { code, message } } contract, so the
// existing frontend needs no response-shape changes.
export const badRequest = (c: Context, message: string) => c.json({ error: { code: "BAD_REQUEST", message } }, 400);
export const unauthorized = (c: Context, message = "Authentication required") => c.json({ error: { code: "UNAUTHORIZED", message } }, 401);
export const forbidden = (c: Context, message = "You do not have permission to perform this action") => c.json({ error: { code: "FORBIDDEN", message } }, 403);
export const notFound = (c: Context, message = "Resource not found") => c.json({ error: { code: "NOT_FOUND", message } }, 404);
export const conflict = (c: Context, message: string) => c.json({ error: { code: "CONFLICT", message } }, 409);
export const upstream = (c: Context, message: string) => c.json({ error: { code: "UPSTREAM_ERROR", message } }, 502);
export const serverError = (c: Context, message = "Internal server error") => c.json({ error: { code: "INTERNAL_ERROR", message } }, 500);
