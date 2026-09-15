import type { VpnProvider, VpnProvisionResult } from "./types";

/**
 * Reflects services/relayService.ts's real, built-in VLESS/Trojan-over-
 * WebSocket relay — select with VPN_PROVIDER="worker-relay" in
 * wrangler.toml. Unlike NullVpnProvider, this is not a placeholder: for
 * vless/trojan users, the "server" they connect to IS this Worker, and
 * it starts accepting their connections the moment their row (and, for
 * Trojan, their precomputed password hash — see db/schema.ts) exists in
 * D1. There is no separate external daemon to configure, so
 * provisioning genuinely completes synchronously rather than being
 * "PENDING" forever like NullVpnProvider honestly reports.
 *
 * WireGuard is not offered at all — it's UDP-based and Cloudflare
 * Workers Sockets are TCP-only, so it could never actually work through
 * this relay (or through this Worker at all).
 */
export class WorkerRelayVpnProvider implements VpnProvider {
  readonly name = "worker-relay";

  async provisionUser(params: { userId: string; serverId: string; protocol: string; port: number; uuid: string }): Promise<VpnProvisionResult> {
    if (params.protocol !== "vless" && params.protocol !== "trojan") {
      return {
        status: "PENDING",
        message: `This Worker's built-in relay supports vless/trojan only — "${params.protocol}" has no real backend configured.`,
      };
    }
    return {
      status: "PROVISIONED",
      message: "This Worker itself relays this user's traffic (services/relayService.ts) — no external VPN daemon needed.",
    };
  }

  async deprovisionUser(): Promise<VpnProvisionResult> {
    return {
      status: "PROVISIONED",
      message: "Deleting/disabling the user's D1 row (already done by the caller) is sufficient — the relay looks up D1 on every connection, so access ends immediately.",
    };
  }
}
