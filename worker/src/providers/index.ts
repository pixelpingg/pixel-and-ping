import type { VpnProvider } from "./types";
import { NullVpnProvider } from "./nullVpnProvider";
import { WorkerRelayVpnProvider } from "./workerRelayVpnProvider";
import type { Env } from "../lib/env";

export function selectVpnProvider(env: Env): VpnProvider {
  switch (env.VPN_PROVIDER) {
    // Add real providers here, e.g.:
    // case "my-relay": return new MyRelayVpnProvider(env);
    case "worker-relay":
      return new WorkerRelayVpnProvider();
    case "null":
    default:
      return new NullVpnProvider();
  }
}

export * from "./types";
