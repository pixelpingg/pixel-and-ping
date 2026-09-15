import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState, Skeleton, EmptyState } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { ArrowUp, ArrowDown, Database, Cloud, RefreshCw } from "lucide-react";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface CfZoneUsage {
  zoneId: string; zoneName: string; requestsToday: number | null;
  bandwidthBytes: string | null; dataAvailable: boolean; partiallyAvailable?: boolean;
  source: string; capturedAt: string;
}
interface CfUsageResponse {
  available: boolean; reason?: string; range: string;
  totalRequestsToday?: number; totalBandwidthBytes?: string; zones: CfZoneUsage[];
}
interface CfAccount { id: string; name: string; status: string; lastSyncAt: string | null; lastSyncError: string | null; }

const RANGE_OPTIONS = [
  { value: "today", labelKey: "traffic.rangeToday" },
  { value: "7d", labelKey: "traffic.range7d" },
  { value: "30d", labelKey: "traffic.range30d" },
];

export default function Traffic() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [summary, setSummary] = useState<any>(null);
  const [cfUsage, setCfUsage] = useState<CfUsageResponse | null>(null);
  const [cfAccounts, setCfAccounts] = useState<CfAccount[]>([]);
  const [range, setRange] = useState("today");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(currentRange = range) {
    setLoading(true);
    setError(null);
    try {
      const [t1, t2, t3] = await Promise.all([
        api.get("/traffic/summary"),
        api.get("/analytics/cloudflare-usage", { params: { range: currentRange } }),
        api.get("/cloudflare/accounts"),
      ]);
      setSummary(t1.data);
      setCfUsage(t2.data);
      setCfAccounts(t3.data.accounts);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load traffic data"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(range); }, [range]);

  async function refreshNow() {
    setRefreshing(true);
    try {
      await api.post("/cloudflare/sync");
      toast("success", t("traffic.refresh"));
      await load(range);
    } catch (err) {
      toast("error", getApiErrorMessage(err, "Only an admin can trigger a manual sync"));
    } finally {
      setRefreshing(false);
    }
  }

  const mostRecentSync = cfAccounts.reduce<string | null>((latest, a) => {
    if (!a.lastSyncAt) return latest;
    if (!latest || new Date(a.lastSyncAt) > new Date(latest)) return a.lastSyncAt;
    return latest;
  }, null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("nav.traffic")}</h1>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
          </select>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />} loading={refreshing} onClick={refreshNow}>
            {t("traffic.refresh")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(range)} />
      ) : (
        <>
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-200 mb-3">{t("traffic.internalAccounting")}</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Upload" value={formatBytes(Number(summary.totalUploadBytes))} icon={<ArrowUp size={17} />} accent="teal" />
              <StatCard label="Download" value={formatBytes(Number(summary.totalDownloadBytes))} icon={<ArrowDown size={17} />} accent="indigo" />
              <StatCard label={t("dashboard.totalTraffic")} value={formatBytes(Number(summary.totalBytes))} icon={<Database size={17} />} accent="amber" />
            </div>
            {summary.sampleSize === 0 ? (
              <p className="text-xs text-slate-500 italic mt-2">{t("traffic.noIngestYet")}</p>
            ) : summary.isEstimated ? (
              <p className="text-xs text-slate-500 italic mt-2">{t("dashboard.estimated")} — reported by the ingestion source, not a Cloudflare-verified meter.</p>
            ) : null}
            <p className="text-xs text-slate-600 italic mt-1">{t("traffic.userLevelUnavailable")}</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Cloud size={16} className="text-signal-teal" />
                <h3 className="font-display text-sm font-semibold text-slate-200">{t("traffic.cloudflareEdge")}</h3>
              </div>
              <span className="text-xs text-slate-500">
                {t("traffic.lastSynced")}: {mostRecentSync ? new Date(mostRecentSync).toLocaleString() : t("traffic.never")}
              </span>
            </div>

            {!cfUsage?.available ? (
              <div className="glass rounded-2xl p-6">
                <EmptyState
                  title={t("dashboard.unavailable")}
                  description={
                    cfAccounts.length === 0
                      ? t("traffic.noCloudflareAccounts")
                      : cfUsage?.reason ?? t("traffic.noSyncYet")
                  }
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <StatCard label={`${t("traffic.requests")} (${t(RANGE_OPTIONS.find((r) => r.value === range)!.labelKey)})`} value={cfUsage.totalRequestsToday ?? "—"} icon={<ArrowUp size={17} />} accent="teal" />
                  <StatCard label={`${t("traffic.bandwidth")} (${t(RANGE_OPTIONS.find((r) => r.value === range)!.labelKey)})`} value={formatBytes(Number(cfUsage.totalBandwidthBytes ?? 0))} icon={<Database size={17} />} accent="indigo" />
                </div>
                <div className="glass rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                        <th className="px-4 py-3 text-start">{t("traffic.zone")}</th>
                        <th className="px-4 py-3 text-start">{t("traffic.requests")}</th>
                        <th className="px-4 py-3 text-start">{t("traffic.bandwidth")}</th>
                        <th className="px-4 py-3 text-start">{t("traffic.source")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cfUsage.zones.map((z) => (
                        <tr key={z.zoneId} className="border-b border-white/5 last:border-0">
                          <td className="px-4 py-3 text-slate-200 font-mono text-xs">{z.zoneName}</td>
                          <td className="px-4 py-3 text-slate-300">
                            {z.dataAvailable ? z.requestsToday : <Badge status="UNKNOWN" label={t("dashboard.unavailable")} />}
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {z.dataAvailable ? formatBytes(Number(z.bandwidthBytes ?? 0)) : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">
                            {z.source}
                            {z.partiallyAvailable && <Badge status="FAIR" label={t("traffic.partiallyAvailable")} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold text-slate-200 mb-3">{t("cloudflare.title")}</h3>
            {cfAccounts.length === 0 ? (
              <EmptyState description={t("traffic.noCloudflareAccounts")} />
            ) : (
              <div className="glass rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                      <th className="px-4 py-3 text-start">{t("cloudflare.accountName")}</th>
                      <th className="px-4 py-3 text-start">{t("common.status")}</th>
                      <th className="px-4 py-3 text-start">{t("traffic.lastSynced")}</th>
                      <th className="px-4 py-3 text-start">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cfAccounts.map((a) => (
                      <tr key={a.id} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 text-slate-200">{a.name}</td>
                        <td className="px-4 py-3"><Badge status={a.status} /></td>
                        <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                          {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString() : t("traffic.never")}
                        </td>
                        <td className="px-4 py-3 text-signal-rose text-xs">{a.lastSyncError ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
