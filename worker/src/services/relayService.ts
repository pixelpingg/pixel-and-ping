import { connect } from "cloudflare:sockets";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { vpnUsers } from "../db/schema";
import { recordTraffic } from "./trafficIngestService";
import { newId } from "../lib/crypto";
import type { Env } from "../lib/env";

/**
 * ===========================================================================
 * WORKER-NATIVE RELAY — a real VLESS/Trojan-over-WebSocket endpoint that
 * runs entirely inside this Cloudflare Worker, so a VPS/external VPN
 * daemon is NOT required for these two protocols. This is exactly the
 * seam the README's "Cloudflare-native VPN/proxy capability" section
 * described as unimplemented (NullVpnProvider was an honest no-op); this
 * file is the real implementation.
 *
 * How it works, plainly:
 *   1. A client (Xray/sing-box/v2rayN/NekoBox etc., configured with
 *      transport=ws, security=tls, path=/api/relay/vless or /trojan)
 *      opens a WebSocket to this Worker's public domain on a
 *      Cloudflare-proxied HTTPS port (443, 2053, 2083, 2087, or 2096).
 *   2. The FIRST WebSocket message contains that protocol's own framed
 *      header (UUID for VLESS, a SHA224 password hash for Trojan) plus
 *      the destination host:port the client actually wants to reach.
 *   3. That identifier is looked up against real vpnUsers rows in D1 —
 *      unknown/inactive/expired users are rejected before anything is
 *      relayed.
 *   4. A genuine outbound TCP socket is opened to the requested
 *      destination via the real `cloudflare:sockets` connect() API (the
 *      same Workers capability healthCheckService.ts already uses for
 *      health probes), and bytes are pumped in both directions until
 *      either side closes.
 *   5. Real byte counts are recorded through the exact same
 *      trafficIngestService.recordTraffic() sink the external Ingestion
 *      API uses — traffic limits and auto-suspend apply identically to
 *      relayed traffic, not just externally-reported traffic.
 *
 * Real, load-bearing limitations — stated plainly, not glossed over:
 *   - TCP only. Workers Sockets cannot do UDP, so VLESS/Trojan's UDP
 *     command is rejected (Xray/sing-box will report "UDP not
 *     supported" for e.g. QUIC/HTTP3/DNS-over-UDP traffic through this
 *     relay — TCP-based traffic, i.e. the overwhelming majority of real
 *     usage, is unaffected).
 *   - One Worker invocation per connection, subject to the Workers
 *     platform's per-invocation CPU/wall-clock limits on your plan —
 *     this is a real constraint of running a relay this way, not a bug
 *     in this code.
 *   - No 0-RTT/session resumption tricks, no multiplexing beyond what
 *     the WebSocket transport itself gives you — this is a direct,
 *     unencrypted-at-this-layer relay (TLS is Cloudflare's edge, same as
 *     any other Workers traffic), not a hardened anti-censorship stack.
 *   - Outbound sockets to Cloudflare's own IP ranges and port 25 are
 *     blocked by the platform itself (see healthCheckService.ts) — a
 *     destination inside those ranges will fail to connect; this is a
 *     Cloudflare product limitation, not something this code can work
 *     around.
 * ===========================================================================
 */

interface ParsedRequest {
  uuid?: string;
  trojanHash?: string;
  address: string;
  port: number;
  payload: Uint8Array;
}

function bytesToUuid(bytes: Uint8Array, offset: number): string {
  const hex = Array.from(bytes.slice(offset, offset + 16)).map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function readIPv6(buf: Uint8Array, offset: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    parts.push(((buf[offset + i * 2] << 8) | buf[offset + i * 2 + 1]).toString(16));
  }
  return parts.join(":");
}

/** VLESS request header — see V2Ray/Xray's VLESS proto docs. */
export function parseVlessHeader(buf: Uint8Array): ParsedRequest | null {
  if (buf.length < 24) return null;
  let offset = 1; // skip version byte
  const uuid = bytesToUuid(buf, offset);
  offset += 16;
  const addonsLen = buf[offset];
  offset += 1 + addonsLen; // skip addons entirely — this project sends none and ignores any sent
  const command = buf[offset];
  offset += 1;
  if (command !== 1) return null; // 1 = TCP; UDP(2)/MUX(3) not supported — see module docstring
  if (offset + 2 > buf.length) return null;
  const port = (buf[offset] << 8) | buf[offset + 1];
  offset += 2;
  const addressType = buf[offset];
  offset += 1;
  let address: string;
  if (addressType === 1) {
    if (offset + 4 > buf.length) return null;
    address = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
    offset += 4;
  } else if (addressType === 2) {
    const len = buf[offset];
    offset += 1;
    if (offset + len > buf.length) return null;
    address = new TextDecoder().decode(buf.slice(offset, offset + len));
    offset += len;
  } else if (addressType === 3) {
    if (offset + 16 > buf.length) return null;
    address = readIPv6(buf, offset);
    offset += 16;
  } else {
    return null;
  }

  return { uuid, address, port, payload: buf.slice(offset) };
}

/** Trojan request header — 56-hex-char SHA224(password) + CRLF + SOCKS5-style address + CRLF. */
export function parseTrojanHeader(buf: Uint8Array): ParsedRequest | null {
  if (buf.length < 56 + 2 + 1 + 1 + 2 + 2) return null;
  const trojanHash = new TextDecoder().decode(buf.slice(0, 56)).toLowerCase();
  let offset = 56;
  if (buf[offset] !== 0x0d || buf[offset + 1] !== 0x0a) return null;
  offset += 2;
  const command = buf[offset];
  offset += 1;
  if (command !== 1) return null; // 1 = TCP connect; UDP associate(3) not supported
  const addressType = buf[offset];
  offset += 1;
  let address: string;
  if (addressType === 1) {
    if (offset + 4 > buf.length) return null;
    address = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
    offset += 4;
  } else if (addressType === 3) {
    const len = buf[offset];
    offset += 1;
    if (offset + len > buf.length) return null;
    address = new TextDecoder().decode(buf.slice(offset, offset + len));
    offset += len;
  } else if (addressType === 4) {
    if (offset + 16 > buf.length) return null;
    address = readIPv6(buf, offset);
    offset += 16;
  } else {
    return null;
  }
  if (offset + 2 > buf.length) return null;
  const port = (buf[offset] << 8) | buf[offset + 1];
  offset += 2;
  if (buf[offset] !== 0x0d || buf[offset + 1] !== 0x0a) return null;
  offset += 2;
  return { trojanHash, address, port, payload: buf.slice(offset) };
}

async function relayToDestination(
  env: Env,
  server: WebSocket,
  protocol: "vless" | "trojan",
  parsed: ParsedRequest,
  userId: string
) {
  let socket;
  try {
    socket = connect({ hostname: parsed.address, port: parsed.port });
    await socket.opened;
  } catch (err) {
    // Silent before this: the WS upgrade always succeeds (101), so
    // wrangler tail showed nothing but a flood of "Ok" lines even when
    // every connection was actually dying right here. Surfacing the
    // real reason so it's visible without needing this file re-read.
    console.error(JSON.stringify({ relay: protocol, event: "upstream_connect_failed", address: parsed.address, port: parsed.port, error: err instanceof Error ? err.message : String(err) }));
    try {
      server.close(1011, "Upstream unreachable");
    } catch {
      /* already closed */
    }
    return;
  }

  console.log(JSON.stringify({ relay: protocol, event: "connected", address: parsed.address, port: parsed.port, userId }));

  const writer = socket.writable.getWriter();
  let uploadBytes = 0;
  let downloadBytes = 0;
  let vlessRespSent = protocol !== "vless"; // Trojan has no response header at all

  if (parsed.payload.length > 0) {
    await writer.write(parsed.payload).catch(() => undefined);
    uploadBytes += parsed.payload.length;
  }

  const periodStart = new Date();
  let finalized = false;
  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    try {
      await writer.close();
    } catch {
      /* already closed */
    }
    try {
      await socket.close();
    } catch {
      /* already closed */
    }
    try {
      server.close(1000, "Session ended");
    } catch {
      /* already closed */
    }
    if (uploadBytes + downloadBytes > 0) {
      await recordTraffic(env, {
        userId,
        uploadBytes,
        downloadBytes,
        periodStart,
        periodEnd: new Date(),
        isEstimated: false,
        idempotencyKey: newId(),
      }).catch(() => undefined);
    }
  };

  server.addEventListener("message", (evt: MessageEvent) => {
    const chunk = evt.data instanceof ArrayBuffer ? new Uint8Array(evt.data) : new TextEncoder().encode(String(evt.data));
    uploadBytes += chunk.byteLength;
    writer.write(chunk).catch(() => finalize());
  });
  server.addEventListener("close", () => finalize());
  server.addEventListener("error", () => finalize());

  const reader = socket.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      downloadBytes += value.byteLength;
      if (!vlessRespSent) {
        const framed = new Uint8Array(value.byteLength + 2); // [version, addonsLen=0]
        framed.set(value, 2);
        server.send(framed);
        vlessRespSent = true;
      } else {
        server.send(value);
      }
    }
  } catch {
    /* upstream dropped */
  }
  await finalize();
}

/**
 * Entry point called directly from src/index.ts's fetch handler for
 * `/api/relay/vless` and `/api/relay/trojan` — deliberately dispatched
 * BEFORE Hono's CORS/logging middleware chain, since those wrap/inspect
 * the Response and a 101 Switching Protocols response carrying a live
 * `webSocket` handoff should not be touched by anything after this
 * function returns it.
 */
export async function handleRelayConnection(request: Request, env: Env, protocol: "vless" | "trojan"): Promise<Response> {
  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade request", { status: 426 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  // As of the websocket_standard_binary_type compat flag (default for
  // compatibility dates >= 2026-03-17, which this project's
  // wrangler.toml is past), binary WS frames arrive as Blob instead of
  // ArrayBuffer — the exact reason every connection was failing with
  // "Expected a binary first frame": the VLESS/Trojan header IS arriving
  // correctly, it's just wrapped in a Blob now. Must be set before
  // accept() so it's in effect before any frame is dispatched.
  server.binaryType = "arraybuffer";
  server.accept();

  const firstMessage = new Promise<ArrayBuffer>((resolve, reject) => {
    const onMessage = (evt: MessageEvent) => {
      server.removeEventListener("message", onMessage);
      if (evt.data instanceof ArrayBuffer) resolve(evt.data);
      else reject(new Error("Expected a binary first frame"));
    };
    const onClose = () => reject(new Error("Closed before handshake completed"));
    server.addEventListener("message", onMessage);
    server.addEventListener("close", onClose, { once: true });
  });

  (async () => {
    try {
      const raw = new Uint8Array(await firstMessage);
      const parsed = protocol === "vless" ? parseVlessHeader(raw) : parseTrojanHeader(raw);
      if (!parsed) {
        console.error(JSON.stringify({ relay: protocol, event: "malformed_header", firstBytes: Array.from(raw.slice(0, 24)) }));
        server.close(1008, "Malformed request");
        return;
      }

      const db = getDb(env);
      const user =
        protocol === "vless"
          ? await db.select().from(vpnUsers).where(eq(vpnUsers.uuid, parsed.uuid!)).get()
          : await db.select().from(vpnUsers).where(eq(vpnUsers.trojanPasswordHash, parsed.trojanHash!)).get();

      const now = Date.now();
      if (!user || user.status !== "ACTIVE" || (user.expiresAt && user.expiresAt.getTime() < now)) {
        console.error(
          JSON.stringify({
            relay: protocol,
            event: "unauthorized",
            reason: !user ? "no matching user for parsed uuid/hash" : user.status !== "ACTIVE" ? `user status is ${user.status}` : "user expired",
            parsedUuidOrHash: protocol === "vless" ? parsed.uuid : parsed.trojanHash,
          })
        );
        server.close(1008, "Unauthorized");
        return;
      }

      await relayToDestination(env, server, protocol, parsed, user.id);
    } catch (err) {
      console.error(JSON.stringify({ relay: protocol, event: "handshake_exception", error: err instanceof Error ? err.message : String(err) }));
      try {
        server.close(1011, "Internal error");
      } catch {
        /* already closed */
      }
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}
