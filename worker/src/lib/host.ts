/**
 * A raw hostname is all that's valid wherever a Server/Endpoint's host is
 * actually used (building a vless/trojan link, dialing a TCP socket,
 * etc.) — but Cloudflare's own dashboard displays Workers URLs as
 * "https://xxx.workers.dev/", so pasting that whole string into a
 * "Host" field is a very natural mistake. Left unsanitized, that
 * produces a vless://uuid@https://host/:443 link no client can parse as
 * an address:port pair, which is exactly what silently broke
 * connections without any validation error at creation time. Applied
 * both at save time (servers.ts/endpoints.ts, so newly stored data is
 * already clean) and at config-generation time (configService.ts, so
 * existing rows created before this fix self-heal automatically).
 */
export function sanitizeHost(raw: string): string {
  return raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
}
