import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "@/lib/api";
import { StatCard } from "@/components/ui/Card";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { Crown, Server, Users, Database } from "lucide-react";

interface OwnerOverviewData {
  totalServers: number;
  totalUsersEverCreated: number;
  totalUsersNow: number;
  totalTrafficBytes: number;
  usersCreatedByAdmin: { adminId: string; username: string; count: number }[];
  byServer: { id: string; name: string; host: string; totalUsers: number; activeUsers: number }[];
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Reachable only by a SUPER_ADMIN — see Sidebar.tsx (no nav entry
// rendered for anyone else) and analytics.ts's /owner-overview
// (requireRole("SUPER_ADMIN") server-side, independent of the frontend).
// This is deliberately not just a filtered view of the shared Dashboard —
// it exists so the operator who actually deployed this instance can see
// their own totals without that being visible to every admin they've
// let into the panel.
export default function OwnerOverview() {
  const [data, setData] = useState<OwnerOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/analytics/owner-overview");
      setData(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load owner overview"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message={error ?? "No data"} onRetry={load} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Crown size={22} className="text-signal-amber" />
        <h1 className="font-display text-2xl font-semibold text-slate-50">Owner Overview</h1>
      </div>
      <p className="text-xs text-slate-500 -mt-4">
        Visible only to your SUPER_ADMIN account — no one else you add to this panel sees this page or its data.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Servers deployed" value={data.totalServers} icon={<Server size={17} />} accent="teal" />
        <StatCard label="Users ever created" value={data.totalUsersEverCreated} icon={<Users size={17} />} accent="indigo" />
        <StatCard label="Users active now" value={data.totalUsersNow} icon={<Users size={17} />} accent="teal" />
        <StatCard label="Total traffic relayed" value={formatBytes(data.totalTrafficBytes)} icon={<Database size={17} />} accent="amber" />
      </div>

      {data.usersCreatedByAdmin.length > 0 && (
        <div className="glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Users created, by admin</h3>
          <div className="space-y-2">
            {data.usersCreatedByAdmin.map((row) => (
              <div key={row.adminId} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{row.username}</span>
                <span className="font-mono text-slate-400">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
              <th className="px-4 py-3 text-start">Server</th>
              <th className="px-4 py-3 text-start">Host</th>
              <th className="px-4 py-3 text-start">Users (active / total)</th>
            </tr>
          </thead>
          <tbody>
            {data.byServer.map((s) => (
              <tr key={s.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-slate-200">{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{s.host}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300">{s.activeUsers} / {s.totalUsers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
