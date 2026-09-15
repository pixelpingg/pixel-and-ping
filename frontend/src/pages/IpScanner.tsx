import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { Radar, ArrowUpDown, Download, Plus, Trash2, Sparkles } from "lucide-react";

interface Endpoint {
  id: string; label: string; host: string; port: number; health: string; score: number;
  latencyMs: number | null; tlsOk: boolean | null; httpStatus: number | null;
  server: { id: string; name: string };
}
interface FrontIpRow { id: string; address: string; label: string | null; source: string; }

function CleanIpPool() {
  const { toast } = useToast();
  const [pool, setPool] = useState<FrontIpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/front-ips");
      setPool(res.data.frontIps);
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function seed() {
    setSeeding(true);
    try {
      const res = await api.post("/front-ips/seed");
      toast("success", `Added ${res.data.inserted} of Cloudflare's published ranges`);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setSeeding(false);
    }
  }

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!newAddress.trim()) return;
    setAdding(true);
    try {
      await api.post("/front-ips", { address: newAddress.trim(), label: newLabel.trim() || undefined });
      setNewAddress("");
      setNewLabel("");
      toast("success", "Added to your clean IP pool");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/front-ips/${id}`);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Clean IP pool</h2>
          <p className="text-[11px] text-slate-500 mt-0.5 max-w-xl">
            IPs here can be picked when generating a config (Config Generator) — the app connects to that address
            instead of the default hostname, while still presenting the real domain over TLS/SNI so Cloudflare routes it
            correctly. This Worker can't verify which of these are actually unblocked on any given network — Cloudflare
            Workers are blocked from even connecting to Cloudflare's own IP ranges, and reachability depends on the end
            user's own ISP anyway. Add only addresses you've already confirmed work from your own client.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<Sparkles size={14} />} loading={seeding} onClick={seed}>
          Add Cloudflare's ranges
        </Button>
      </div>

      <form onSubmit={addCustom} className="flex flex-wrap gap-2">
        <input className="input flex-1 min-w-[160px]" placeholder="e.g. 172.64.10.5" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
        <input className="input flex-1 min-w-[160px]" placeholder="Label (optional)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        <Button type="submit" size="sm" icon={<Plus size={14} />} loading={adding}>Add</Button>
      </form>

      {loading ? (
        <TableSkeleton />
      ) : pool.length === 0 ? (
        <EmptyState description="No clean IPs yet — seed Cloudflare's published ranges or add your own above." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {pool.map((ip) => (
            <div key={ip.id} className="flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-1.5 text-xs">
              <span className="font-mono text-slate-300">{ip.address}</span>
              {ip.label && <span className="text-slate-500">{ip.label}</span>}
              <Badge status={ip.source === "SEED" ? "UNKNOWN" : "ACTIVE"} label={ip.source} />
              <button onClick={() => remove(ip.id)} className="text-slate-500 hover:text-signal-rose"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IpScanner() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "latencyMs">("score");
  const [healthFilter, setHealthFilter] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/health-checks/endpoints", { params: { sortBy, health: healthFilter || undefined } });
      setEndpoints(res.data.endpoints);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load endpoint health"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [sortBy, healthFilter]);

  async function scanAll() {
    setScanning(true);
    try {
      await api.post("/health-checks/scan-all");
      toast("success", "Scan complete");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  function exportCsv() {
    const header = "label,server,host,port,health,score,latencyMs,tlsOk,httpStatus\n";
    const rows = endpoints.map((e) =>
      [e.label, e.server?.name, e.host, e.port, e.health, e.score, e.latencyMs ?? "", e.tlsOk ?? "", e.httpStatus ?? ""].join(",")
    );
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ip-scanner-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    endpoints.forEach((e) => { counts[e.health] = (counts[e.health] ?? 0) + 1; });
    return counts;
  }, [endpoints]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-50">{t("scanner.title")}</h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage a pool of clean IPs for configs below, and scan the health of endpoints already registered in your own server inventory.
          </p>
        </div>
      </div>

      <CleanIpPool />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Registered endpoint health</h2>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Download size={15} />} onClick={exportCsv}>Export</Button>
          <Button icon={<Radar size={15} />} loading={scanning} onClick={scanAll}>{t("scanner.scan")}</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(summary).map(([health, count]) => (
          <div key={health} className="glass rounded-xl px-3 py-2 flex items-center gap-2">
            <Badge status={health} />
            <span className="text-sm font-mono text-slate-300">{count}</span>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-4 flex flex-wrap gap-3">
        <select className="input sm:w-48" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
          <option value="">{t("common.filter")}</option>
          <option value="EXCELLENT">Excellent</option>
          <option value="GOOD">Good</option>
          <option value="FAIR">Fair</option>
          <option value="POOR">Poor</option>
          <option value="OFFLINE">Offline</option>
        </select>
        <button
          onClick={() => setSortBy(sortBy === "score" ? "latencyMs" : "score")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-slate-300 border border-white/5 hover:bg-white/5"
        >
          <ArrowUpDown size={13} /> Sort: {sortBy === "score" ? t("scanner.score") : t("servers.latency")}
        </button>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? <TableSkeleton /> : error ? <ErrorState message={error} onRetry={load} /> : endpoints.length === 0 ? (
          <EmptyState description="No endpoints configured yet. Add endpoints under Servers to scan them here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th className="px-4 py-3 text-start">Label</th>
                  <th className="px-4 py-3 text-start">Server</th>
                  <th className="px-4 py-3 text-start">Host:Port</th>
                  <th className="px-4 py-3 text-start">{t("servers.latency")}</th>
                  <th className="px-4 py-3 text-start">TLS</th>
                  <th className="px-4 py-3 text-start">{t("scanner.score")}</th>
                  <th className="px-4 py-3 text-start">Health</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-slate-200">{e.label}</td>
                    <td className="px-4 py-3 text-slate-400">{e.server?.name}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{e.host}:{e.port}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{e.latencyMs !== null ? `${e.latencyMs}ms` : "—"}</td>
                    <td className="px-4 py-3">{e.tlsOk === null ? "—" : e.tlsOk ? <Badge status="HEALTHY" label="OK" /> : <Badge status="UNHEALTHY" label="Fail" />}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{e.score}</td>
                    <td className="px-4 py-3"><Badge status={e.health} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
