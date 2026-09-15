import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { ErrorState, Skeleton, EmptyState } from "@/components/ui/States";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from "recharts";

export default function Analytics() {
  const { t } = useTranslation();
  const [series, setSeries] = useState<any[]>([]);
  const [health, setHealth] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [t1, t2] = await Promise.all([api.get("/analytics/traffic-series"), api.get("/analytics/server-health")]);
      setSeries(t1.data.series);
      setHealth(t2.data.servers);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="space-y-4"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-slate-50">{t("nav.analytics")}</h1>

      <div className="glass rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-slate-200 mb-4">{t("dashboard.requestsAnalytics")}</h3>
        {series.length === 0 ? <EmptyState /> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A2540" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => new Date(v).toLocaleDateString()} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip contentStyle={{ background: "#111A2E", border: "1px solid #243252", borderRadius: 12 }} />
              <Line type="monotone" dataKey="upload" stroke="#2DD4BF" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="download" stroke="#6366F1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="glass rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-slate-200 mb-4">{t("dashboard.serverHealth")}</h3>
        {health.length === 0 ? <EmptyState /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={health}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A2540" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip contentStyle={{ background: "#111A2E", border: "1px solid #243252", borderRadius: 12 }} />
              <Bar dataKey="avgLatencyMs" fill="#6366F1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
