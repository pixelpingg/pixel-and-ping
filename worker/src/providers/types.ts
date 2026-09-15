// Same interfaces as backend/src/providers/types.ts — the Workers backend
// is written against these abstractions too, so a real VpnProvider can be
// dropped in later without touching routes or the frontend.

export interface VpnProvisionResult {
  status: "PROVISIONED" | "PENDING" | "FAILED";
  message: string;
}

export interface VpnProvider {
  readonly name: string;
  provisionUser(params: { userId: string; serverId: string; protocol: string; port: number; uuid: string }): Promise<VpnProvisionResult>;
  deprovisionUser(params: { userId: string; serverId: string }): Promise<VpnProvisionResult>;
}
