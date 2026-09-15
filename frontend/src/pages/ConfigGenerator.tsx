import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, RefreshCw, Ban, Check, ShieldCheck, ShieldQuestion } from "lucide-react";

interface VpnUser { id: string; username: string; provisioningStatus: string; provisioningMessage: string | null; }
interface Configuration {
  id: string; protocol: string; port: number; tls: boolean; rawConfig: string;
  version: number; isRevoked: boolean; createdAt: string;
  cloudflareAccountId: string | null; cloudflareZoneId: string | null;
  hostname: string | null; cloudflareVerified: boolean;
}
interface CfAccount { id: string; name: string; }
interface CfZone { id: string; name: string; status: string; }
interface PortRow { id: string; number: number; type: string; }
interface FrontIpRow { id: string; address: string; label: string | null; source: string; }

// Above this many configs in one batch, confirm before generating —
// see Notifications-style locale handling in configGenerator.manyConfigs*.
const MANY_CONFIGS_THRESHOLD = 100;

export default function ConfigGenerator() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [users, setUsers] = useState<VpnUser[]>([]);
  const [userId, setUserId] = useState("");
  const [configs, setConfigs] = useState<Configuration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [cfAccounts, setCfAccounts] = useState<CfAccount[]>([]);
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfZones, setCfZones] = useState<CfZone[]>([]);
  const [cfZoneId, setCfZoneId] = useState("");
  const [hostname, setHostname] = useState("");

  const [ports, setPorts] = useState<PortRow[]>([]);
  const [selectedPorts, setSelectedPorts] = useState<number[]>([]);
  const [frontIpPool, setFrontIpPool] = useState<FrontIpRow[]>([]);
  const [selectedFrontIps, setSelectedFrontIps] = useState<string[]>([]);
  const [confirmManyOpen, setConfirmManyOpen] = useState(false);

  useEffect(() => {
    api.get("/users", { params: { pageSize: 100 } }).then((res) => setUsers(res.data.users)).catch(() => undefined);
    api.get("/cloudflare/accounts").then((res) => setCfAccounts(res.data.accounts)).catch(() => undefined);
    api.get("/ports").then((res) => setPorts(res.data.ports)).catch(() => undefined);
    api.get("/front-ips").then((res) => setFrontIpPool(res.data.frontIps)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setCfZoneId("");
    setCfZones([]);
    if (!cfAccountId) return;
    api.get(`/cloudflare/accounts/${cfAccountId}/zones`).then((res) => setCfZones(res.data.zones)).catch(() => undefined);
  }, [cfAccountId]);

  async function loadConfigs(uid: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/configs/user/${uid}`);
      setConfigs(res.data.configurations);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load configurations"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (userId) loadConfigs(userId);
    else setConfigs([]);
  }, [userId]);

  const selectedUser = users.find((u) => u.id === userId);
  const totalConfigsToGenerate = Math.max(1, selectedPorts.length) * Math.max(1, selectedFrontIps.length);

  function togglePort(n: number) {
    setSelectedPorts((prev) => (prev.includes(n) ? prev.filter((p) => p !== n) : [...prev, n]));
  }
  function toggleFrontIp(addr: string) {
    setSelectedFrontIps((prev) => (prev.includes(addr) ? prev.filter((a) => a !== addr) : [...prev, addr]));
  }

  async function doGenerate() {
    if (!userId) return;
    setGenerating(true);
    try {
      await api.post(`/configs/user/${userId}/generate`, {
        cloudflareAccountId: cfAccountId || undefined,
        cloudflareZoneId: cfZoneId || undefined,
        hostname: hostname || undefined,
        ports: selectedPorts.length > 0 ? selectedPorts : undefined,
        frontIps: selectedFrontIps.length > 0 ? selectedFrontIps : undefined,
      });
      toast("success", `Generated ${totalConfigsToGenerate} configuration${totalConfigsToGenerate > 1 ? "s" : ""}`);
      loadConfigs(userId);
    } catch (err) {
      toast("error", getApiErrorMessage(err, "Generation stopped — the referenced Cloudflare resource could not be verified"));
    } finally {
      setGenerating(false);
      setConfirmManyOpen(false);
    }
  }

  function generate() {
    if (totalConfigsToGenerate > MANY_CONFIGS_THRESHOLD) {
      setConfirmManyOpen(true);
      return;
    }
    doGenerate();
  }

  async function revoke(id: string) {
    try {
      await api.post(`/configs/${id}/revoke`);
      toast("success", "Configuration revoked");
      loadConfigs(userId);
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  function copy(c: Configuration) {
    navigator.clipboard.writeText(c.rawConfig);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function download(c: Configuration) {
    const blob = new Blob([c.rawConfig], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `config-v${c.version}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={confirmManyOpen}
        onClose={() => setConfirmManyOpen(false)}
        onConfirm={doGenerate}
        loading={generating}
        title={t("configGenerator.manyConfigsTitle")}
        message={t("configGenerator.manyConfigsMessage", { count: totalConfigsToGenerate })}
      />

      <h1 className="font-display text-2xl font-semibold text-slate-50">{t("nav.configGenerator")}</h1>

      <div className="glass rounded-2xl p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("users.title")}</span>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          </label>
          {selectedUser && (
            <div className="flex items-end">
              <div>
                <span className="text-xs font-medium text-slate-400 mb-1.5 block">VPN provisioning status</span>
                <Badge
                  status={selectedUser.provisioningStatus === "PROVISIONED" ? "HEALTHY" : selectedUser.provisioningStatus === "FAILED" ? "UNHEALTHY" : "UNKNOWN"}
                  label={selectedUser.provisioningStatus.replace("_", " ")}
                />
                {selectedUser.provisioningMessage && (
                  <p className="text-[11px] text-slate-500 mt-1 max-w-sm">{selectedUser.provisioningMessage}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {ports.length > 0 && (
          <div>
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">Ports (leave empty for the user's default port)</span>
            <div className="flex flex-wrap gap-2">
              {ports.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => togglePort(p.number)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                    selectedPorts.includes(p.number) ? "bg-brand-500/20 border-brand-500/50 text-brand-200" : "border-white/10 text-slate-400 hover:border-white/20"
                  }`}
                >
                  {p.number} <span className="opacity-60">· {p.type === "TLS" ? "TLS" : "non-TLS"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {frontIpPool.length > 0 && (
          <div>
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">
              Clean IPs (each selected IP gets its own config — manage the pool under IP Scanner)
            </span>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {frontIpPool.map((ip) => (
                <button
                  type="button"
                  key={ip.id}
                  onClick={() => toggleFrontIp(ip.address)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                    selectedFrontIps.includes(ip.address) ? "bg-brand-500/20 border-brand-500/50 text-brand-200" : "border-white/10 text-slate-400 hover:border-white/20"
                  }`}
                >
                  {ip.address}
                </button>
              ))}
            </div>
          </div>
        )}

        {(selectedPorts.length > 1 || selectedFrontIps.length > 1) && (
          <p className="text-xs text-slate-500">
            This will generate <span className="font-mono text-slate-300">{totalConfigsToGenerate}</span> configurations
            ({Math.max(1, selectedPorts.length)} port{selectedPorts.length !== 1 ? "s" : ""} × {Math.max(1, selectedFrontIps.length)} IP{selectedFrontIps.length !== 1 ? "s" : ""}).
          </p>
        )}

        <div className="border-t border-white/5 pt-4">
          <p className="text-xs text-slate-500 mb-3">
            Optional — tie this configuration to a real, verified Cloudflare zone/hostname. Generation is refused
            if the zone or DNS record doesn't actually exist.
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("cloudflare.title")}</span>
              <select className="input" value={cfAccountId} onChange={(e) => setCfAccountId(e.target.value)}>
                <option value="">None</option>
                {cfAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("cloudflare.zones")}</span>
              <select className="input" disabled={!cfAccountId} value={cfZoneId} onChange={(e) => setCfZoneId(e.target.value)}>
                <option value="">—</option>
                {cfZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400 mb-1.5 block">Hostname</span>
              <input className="input" disabled={!cfZoneId} placeholder="vpn.example.com" value={hostname} onChange={(e) => setHostname(e.target.value)} />
            </label>
          </div>
        </div>

        <Button icon={<RefreshCw size={15} />} disabled={!userId} loading={generating} onClick={generate}>
          Generate new
        </Button>
      </div>

      {!userId ? (
        <EmptyState description="Select a user to view and manage their configuration history." />
      ) : loading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => loadConfigs(userId)} />
      ) : configs.length === 0 ? (
        <EmptyState description="No configuration generated yet for this user." action={<Button size="sm" onClick={generate}>Generate</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {configs.map((c) => (
            <div key={c.id} className="glass rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-slate-100">v{c.version}</span>
                  <Badge status={c.isRevoked ? "SUSPENDED" : "ACTIVE"} label={c.isRevoked ? "Revoked" : "Active"} />
                </div>
                <span className="text-xs text-slate-500 font-mono">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
                <div>Protocol<div className="text-slate-200 uppercase">{c.protocol}</div></div>
                <div>Port<div className="text-slate-200 font-mono">{c.port}</div></div>
                <div>TLS<div className="text-slate-200">{c.tls ? "Yes" : "No"}</div></div>
              </div>
              {c.hostname && (
                <div className="flex items-center gap-1.5 text-xs">
                  {c.cloudflareVerified ? (
                    <ShieldCheck size={13} className="text-signal-teal" />
                  ) : (
                    <ShieldQuestion size={13} className="text-signal-amber" />
                  )}
                  <span className="text-slate-400 font-mono">{c.hostname}</span>
                  <span className="text-slate-500">{c.cloudflareVerified ? "— DNS record verified" : "— not Cloudflare-verified"}</span>
                </div>
              )}
              <div className="flex gap-4 items-start">
                <div className="bg-white p-2 rounded-lg shrink-0"><QRCodeSVG value={c.rawConfig} size={90} /></div>
                <code className="text-xs text-slate-400 break-all font-mono leading-relaxed">{c.rawConfig}</code>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="secondary" icon={copiedId === c.id ? <Check size={13} /> : <Copy size={13} />} onClick={() => copy(c)}>
                  {copiedId === c.id ? t("common.copied") : t("common.copy")}
                </Button>
                <Button size="sm" variant="secondary" icon={<Download size={13} />} onClick={() => download(c)}>{t("common.download")}</Button>
                {!c.isRevoked && (
                  <Button size="sm" variant="danger" icon={<Ban size={13} />} onClick={() => revoke(c.id)}>Revoke</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
