import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { StatCard } from "@/components/ui/Card";
import { Skeleton, ErrorState, EmptyState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DailyUsageCard } from "@/components/cloudflare/DailyUsageCard";
import {
  Users, UserCheck, Wifi, Gauge, Server as ServerIcon, Cloud, ArrowDownUp, HeartPulse, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";

interface DashboardData {
  totalUsers: number;
  activeUsers: number;
  onlineUsers: number;
  activeServers: number;
  totalServers: number;
  cloudflareAccounts: number;
  healthyEndpoints: number;
  totalEndpoints: number;
  totalTrafficBytes: string;
  dailyRequests: number | null;
  dailyRequestsAvailable: boolean;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const PIE_COLORS = ["#2DD4BF", "#6366F1", "#F59E0B", "#FB7185", "#64748B"];

export default function Dashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [series, setSeries] = useState<any[]>([]);
  const [activity, setActivity] = useState<any>(null);
  const [health, setHealth] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Shown once per browser — a licensing/attribution notice, not
  // per-admin state worth a DB round trip for something this low-stakes.
  const [showFreeNotice, setShowFreeNotice] = useState(() => localStorage.getItem("pixelping_free_notice_seen") !== "1");

  function dismissFreeNotice() {
    localStorage.setItem("pixelping_free_notice_seen", "1");
    setShowFreeNotice(false);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dash, traffic, act, srvHealth] = await Promise.all([
        api.get("/analytics/dashboard"),
        api.get("/analytics/traffic-series"),
        api.get("/analytics/user-activity"),
        api.get("/analytics/server-health"),
      ]);
      setData(dash.data);
      setSeries(traffic.data.series);
      setActivity(act.data);
      setHealth(srvHealth.data.servers);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load dashboard data"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  if (error || !data) {
    return <ErrorState message={error ?? "No data"} onRetry={load} />;
  }

  const activityPie = (activity?.byStatus ?? []).map((s: any) => ({ name: s.status, value: s.count }));

  return (
    <div className="space-y-6">
      <Modal open={showFreeNotice} onClose={dismissFreeNotice} title="">
        <div className="text-center space-y-3 py-2">
          <Sparkles size={28} className="mx-auto text-signal-amber animate-pulse" />
          <h3 className="font-display text-lg font-semibold text-slate-50">{t("freeNotice.title")}</h3>
          <p className="text-sm text-slate-400 leading-relaxed">{t("freeNotice.body")}</p>
          <Button className="w-full mt-2" onClick={dismissFreeNotice}>{t("freeNotice.dismiss")}</Button>
        </div>
      </Modal>

      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("dashboard.title")}</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t("dashboard.totalUsers")} value={data.totalUsers} icon={<Users size={17} />} accent="teal" />
        <StatCard label={t("dashboard.activeUsers")} value={data.activeUsers} icon={<UserCheck size={17} />} accent="indigo" />
        <StatCard label={t("dashboard.onlineUsers")} value={data.onlineUsers} icon={<Wifi size={17} />} accent="teal" />
        <StatCard
          label={t("dashboard.dailyRequests")}
          value={data.dailyRequestsAvailable ? data.dailyRequests : t("dashboard.unavailable")}
          icon={<Gauge size={17} />}
          accent="amber"
        />
        <StatCard label={t("dashboard.activeServers")} value={`${data.activeServers}/${data.totalServers}`} icon={<ServerIcon size={17} />} accent="indigo" />
        <StatCard label={t("dashboard.cloudflareAccounts")} value={data.cloudflareAccounts} icon={<Cloud size={17} />} accent="teal" />
        <StatCard label={t("dashboard.totalTraffic")} value={formatBytes(Number(data.totalTrafficBytes))} icon={<ArrowDownUp size={17} />} accent="rose" />
        <StatCard label={t("dashboard.ipHealth")} value={`${data.healthyEndpoints}/${data.totalEndpoints}`} icon={<HeartPulse size={17} />} accent="amber" />
      </div>

      <DailyUsageCard />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass rounded-2xl p-5">
          <h3 className="font-display text-sm font-semibold text-slate-200 mb-4">{t("dashboard.trafficAnalytics")}</h3>
          {series.length === 0 ? (
            <EmptyState description="Traffic will appear here once usage data is recorded." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="upload" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2DD4BF" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2DD4BF" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="download" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A2540" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => new Date(v).toLocaleDateString()} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => formatBytes(v)} />
                <Tooltip contentStyle={{ background: "#111A2E", border: "1px solid #243252", borderRadius: 12 }} formatter={(v: number) => formatBytes(v)} />
                <Area type="monotone" dataKey="upload" stroke="#2DD4BF" fill="url(#upload)" strokeWidth={2} />
                <Area type="monotone" dataKey="download" stroke="#6366F1" fill="url(#download)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-display text-sm font-semibold text-slate-200 mb-4">{t("dashboard.userActivity")}</h3>
          {activityPie.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={activityPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {activityPie.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#111A2E", border: "1px solid #243252", borderRadius: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {activityPie.map((s: any, i: number) => (
              <span key={s.name} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <h3 className="font-display text-sm font-semibold text-slate-200 mb-4">{t("dashboard.serverHealth")}</h3>
        {health.length === 0 ? (
          <EmptyState description="Add a server to see health metrics here." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={health}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A2540" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip contentStyle={{ background: "#111A2E", border: "1px solid #243252", borderRadius: 12 }} />
              <Bar dataKey="avgLatencyMs" fill="#2DD4BF" radius={[6, 6, 0, 0]} name="Avg latency (ms)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
