import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/ui/States";

interface LogEntry {
  id: string; action: string; targetType: string | null; targetId: string | null;
  createdAt: string; ipAddress: string | null; admin: { username: string; email: string } | null;
}

export default function Logs() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/logs", { params: { page, action: actionFilter || undefined } });
      setLogs(res.data.logs);
      setTotalPages(res.data.pagination.totalPages || 1);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load activity logs"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page, actionFilter]);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-semibold text-slate-50">{t("nav.logs")}</h1>

      <div className="glass rounded-2xl p-4">
        <input
          className="input"
          placeholder={`${t("common.filter")} (e.g. user.create)`}
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
        />
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? <TableSkeleton /> : error ? <ErrorState message={error} onRetry={load} /> : logs.length === 0 ? (
          <EmptyState description="No activity recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th className="px-4 py-3 text-start">Action</th>
                  <th className="px-4 py-3 text-start">Admin</th>
                  <th className="px-4 py-3 text-start">Target</th>
                  <th className="px-4 py-3 text-start">IP</th>
                  <th className="px-4 py-3 text-start">Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-xs text-signal-teal">{l.action}</td>
                    <td className="px-4 py-3 text-slate-300">{l.admin?.username ?? "system"}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{l.targetType ? `${l.targetType}#${l.targetId?.slice(0, 8)}` : "—"}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{l.ipAddress ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button key={i} onClick={() => setPage(i + 1)} className={`h-8 w-8 rounded-lg text-xs font-medium ${page === i + 1 ? "bg-ping-gradient text-white" : "text-slate-400 hover:bg-white/5"}`}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
