import type { VpnProvider, VpnProvisionResult } from "./types";

/**
 * Default VpnProvider for the Workers backend — same honesty contract as
 * backend/src/providers/nullVpnProvider.ts. Cloudflare Workers can verify
 * DNS/zone resources (services/cloudflareService.ts) and, where a real
 * TCP-speaking backend exists, relay traffic to it via the `connect()`
 * Workers Sockets API (see services/healthCheckService.ts for a working
 * example of that API in this codebase) — but Cloudflare itself does not
 * provision an arbitrary VLESS/Trojan/WireGuard server. Actually running
 * one is this interface's job, implemented against whatever real,
 * authorized backend you bring.
 */
export class NullVpnProvider implements VpnProvider {
  readonly name = "null";

  async provisionUser(): Promise<VpnProvisionResult> {
    return {
      status: "PENDING",
      message:
        "No VpnProvider is configured (VPN_PROVIDER unset or 'null'). A connection configuration was generated and, if a hostname was supplied, its DNS record was verified against Cloudflare — but nothing has actually configured a VPN-speaking server to accept it. Implement providers/vpnProvider against a real backend and set VPN_PROVIDER to enable real provisioning.",
    };
  }

  async deprovisionUser(): Promise<VpnProvisionResult> {
    return { status: "PENDING", message: "No VpnProvider is configured; nothing to deprovision on a real server." };
  }
}
