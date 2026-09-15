import { eq, desc } from "drizzle-orm";
import { getDb } from "../lib/db";
import { vpnUsers, servers, endpoints, configurations } from "../db/schema";
import { verifyZoneOwnership, findDnsRecord } from "./cloudflareService";
import { newId } from "../lib/crypto";
import { sanitizeHost } from "../lib/host";
import type { Env } from "../lib/env";

export interface GenerateConfigOptions {
  cloudflareAccountId?: string;
  cloudflareZoneId?: string;
  hostname?: string;
  // Every port in this list gets its own configuration row/link, all
  // pointing at the same relay path — lets one user carry a TLS config
  // (443/2053/2083/2087/2096/8443) and a non-TLS one side by side, or
  // several TLS ports for the same client app to try in sequence.
  // Falls back to the user's single stored `port` when omitted, so
  // every existing caller (single-port generation) is unaffected.
  ports?: number[];
  // Optional front-facing IP/host overrides (e.g. from the IP Scanner —
  // see services/relayService.ts's docstring for what "clean" means
  // here) — each produces its own extra configuration row using that
  // address instead of the server/endpoint host, while still pointing
  // the WebSocket "Host"/SNI at the real domain so Cloudflare still
  // routes it correctly.
  frontIps?: string[];
}

export class ConfigGenerationError extends Error {}

function buildRawConfig(protocol: string, uuid: string, username: string, tls: boolean, address: string, port: number, sniHost: string): string {
  switch (protocol) {
    case "vless":
      // This Worker cannot listen on a raw TCP port (no VPS/daemon
      // exists on the Workers platform) — the only real transport this
      // backend can ever offer for VLESS is its own built-in relay (see
      // services/relayService.ts), which speaks WebSocket-over-TLS.
      // "host" must be this Worker's own public domain for this link to
      // actually connect anywhere; security/type are fixed for the same
      // reason regardless of the user's stored tls flag, since a plain
      // ws:// link cannot reach a Cloudflare-fronted domain at all.
      return `vless://${uuid}@${address}:${port}?encryption=none&security=tls&type=ws&host=${encodeURIComponent(sniHost)}&sni=${encodeURIComponent(sniHost)}&path=${encodeURIComponent("/api/relay/vless")}#${encodeURIComponent(username)}`;
    case "trojan":
      return `trojan://${uuid}@${address}:${port}?security=tls&type=ws&host=${encodeURIComponent(sniHost)}&sni=${encodeURIComponent(sniHost)}&path=${encodeURIComponent("/api/relay/trojan")}#${encodeURIComponent(username)}`;
    default:
      // WireGuard was removed: it's UDP-based and Cloudflare Workers
      // Sockets are TCP-only (see relayService.ts's module docstring),
      // so this backend could never actually serve it — shipping a
      // config for it would be exactly the kind of fabricated feature
      // this project's own README explicitly says not to do.
      return `${protocol}://${uuid}@${address}:${port}?tls=${tls}`;
  }
}

export interface ConfigRow {
  id: string;
  userId: string;
  serverId: string | null;
  protocol: string;
  port: number;
  tls: boolean;
  rawConfig: string;
  version: number;
  isRevoked: boolean;
  cloudflareAccountId: string | null;
  cloudflareZoneId: string | null;
  hostname: string | null;
  cloudflareVerified: boolean;
  createdAt: Date;
}

/**
 * Same "never fabricate" contract as backend/src/services/configService.ts:
 * config generation always builds from real, stored user/server data, and
 * — critically — if a Cloudflare zone/hostname is attached, this function
 * verifies it live against the real Cloudflare API (zone ownership + DNS
 * record existence) before building anything. Generation is refused
 * (throws ConfigGenerationError) if that verification fails.
 *
 * What this does NOT do: claim Cloudflare itself provisions the VLESS/
 * Trojan protocol. Cloudflare's role here is strictly DNS/zone
 * verification of the hostname the config points at — the actual VPN
 * server behind that hostname is a VpnProvider concern (see
 * services/vpnProvisioningService.ts).
 *
 * Returns every generated row (one per requested port × front-IP
 * combination) plus `primary`, the first one — existing callers that
 * only care about a single config keep working against `primary`
 * unchanged; callers that requested multiple ports/front-IPs can use
 * `all`.
 */
export async function generateConfiguration(env: Env, userId: string, options: GenerateConfigOptions = {}): Promise<{ primary: ConfigRow; all: ConfigRow[] }> {
  const db = getDb(env);
  const user = await db.select().from(vpnUsers).where(eq(vpnUsers.id, userId)).get();
  if (!user) throw new ConfigGenerationError("User not found");
  if (!user.serverId) throw new ConfigGenerationError("User has no assigned server; cannot generate a configuration");

  const server = await db.select().from(servers).where(eq(servers.id, user.serverId)).get();
  if (!server) throw new ConfigGenerationError("Assigned server no longer exists");

  let sniHost = sanitizeHost(server.host);
  if (user.preferredEndpointId) {
    const ep = await db.select().from(endpoints).where(eq(endpoints.id, user.preferredEndpointId)).get();
    if (ep) sniHost = sanitizeHost(ep.host);
  }

  let cloudflareVerified = false;
  if (options.cloudflareAccountId && options.cloudflareZoneId) {
    const ownsZone = await verifyZoneOwnership(env, options.cloudflareAccountId, options.cloudflareZoneId);
    if (!ownsZone) {
      throw new ConfigGenerationError(
        "The selected zone does not belong to the selected Cloudflare account (verified live against the Cloudflare API). Generation stopped."
      );
    }
    if (options.hostname) {
      const record = await findDnsRecord(env, options.cloudflareAccountId, options.cloudflareZoneId, options.hostname);
      if (!record) {
        throw new ConfigGenerationError(
          `No DNS record for "${options.hostname}" was found in the selected zone. Create the record in Cloudflare first — Pixel & Ping does not fabricate hostnames that don't exist.`
        );
      }
      sniHost = sanitizeHost(options.hostname);
      cloudflareVerified = true;
    }
  }

  const targetPorts = options.ports && options.ports.length > 0 ? Array.from(new Set(options.ports)) : [user.port];
  // A front-IP is an alternate address to actually dial (e.g. a
  // Cloudflare-range IP the IP Scanner found reachable) while the
  // WebSocket Host/SNI still names the real domain, so Cloudflare's
  // edge still routes the request correctly — omitting it (the common
  // case) just uses the real domain as both address and SNI, same as
  // before this option existed.
  const targetAddresses = options.frontIps && options.frontIps.length > 0 ? options.frontIps.map(sanitizeHost) : [sniHost];

  const previous = await db.select().from(configurations).where(eq(configurations.userId, userId)).orderBy(desc(configurations.version)).limit(1).all();
  let version = previous[0]?.version ?? 0;

  const rows: ConfigRow[] = [];
  for (const address of targetAddresses) {
    for (const port of targetPorts) {
      version += 1;
      const rawConfig = buildRawConfig(user.protocol, user.uuid, user.username, user.tls, address, port, sniHost);
      const row: ConfigRow = {
        id: newId(),
        userId,
        serverId: user.serverId,
        protocol: user.protocol,
        port,
        tls: user.tls,
        rawConfig,
        version,
        isRevoked: false,
        cloudflareAccountId: options.cloudflareAccountId ?? null,
        cloudflareZoneId: options.cloudflareZoneId ?? null,
        hostname: options.hostname ?? null,
        cloudflareVerified,
        createdAt: new Date(),
      };
      rows.push(row);
    }
  }

  await db.insert(configurations).values(rows);
  return { primary: rows[0], all: rows };
}

export async function revokeConfiguration(env: Env, configId: string) {
  const db = getDb(env);
  await db.update(configurations).set({ isRevoked: true }).where(eq(configurations.id, configId));
  return db.select().from(configurations).where(eq(configurations.id, configId)).get();
}
