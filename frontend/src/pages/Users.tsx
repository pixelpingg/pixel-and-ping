import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/store/ToastContext";
import { Plus, Search, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface VpnUser {
  id: string;
  username: string;
  status: string;
  isOnline: boolean;
  createdAt: string;
  expiresAt: string | null;
  trafficLimitBytes: string | null;
  requestLimit: number | null;
  lastSeenAt: string | null;
  server: { id: string; name: string } | null;
  preferredEndpoint: { id: string; label: string; latencyMs: number | null; health: string } | null;
  provisioningStatus: string;
}

export default function Users() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [users, setUsers] = useState<VpnUser[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/users", { params: { search: search || undefined, status: status || undefined, page } });
      setUsers(res.data.users);
      setTotalPages(res.data.pagination.totalPages || 1);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load users"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page, status]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function toggleStatus(u: VpnUser) {
    setBusyId(u.id);
    try {
      const endpoint = u.status === "SUSPENDED" ? "enable" : "suspend";
      await api.post(`/users/${u.id}/${endpoint}`);
      toast("success", endpoint === "enable" ? "User enabled" : "User suspended");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function regenerateConfig(u: VpnUser) {
    setBusyId(u.id);
    try {
      await api.post(`/users/${u.id}/config/regenerate`);
      toast("success", "Configuration regenerated");
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete(`/users/${pendingDelete}`);
      toast("success", "User deleted");
      setPendingDelete(null);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("users.title")}</h1>
        <Button icon={<Plus size={16} />} onClick={() => navigate("/users/create")}>{t("users.createUser")}</Button>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-xl px-3">
          <Search size={15} className="text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.search")}
            className="bg-transparent flex-1 py-2.5 text-sm outline-none text-slate-200"
          />
        </form>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input sm:w-48">
          <option value="">{t("common.filter")}</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : users.length === 0 ? (
          <EmptyState
            title={t("common.noResults")}
            description="Create your first VPN user to get started."
            action={<Button size="sm" icon={<Plus size={14} />} onClick={() => navigate("/users/create")}>{t("users.createUser")}</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th className="px-4 py-3 text-start">{t("users.username")}</th>
                  <th className="px-4 py-3 text-start">{t("common.status")}</th>
                  <th className="px-4 py-3 text-start">{t("users.server")}</th>
                  <th className="px-4 py-3 text-start">{t("nav.endpoints")}</th>
                  <th className="px-4 py-3 text-start">{t("users.expiration")}</th>
                  <th className="px-4 py-3 text-start">{t("users.lastSeen")}</th>
                  <th className="px-4 py-3 text-end">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-slate-200">{u.username}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge status={u.status} />
                        {u.isOnline && <Badge status="ONLINE" label={t("common.online")} />}
                        {u.provisioningStatus === "FAILED" && <Badge status="UNHEALTHY" label="Provisioning failed" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{u.server?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {u.preferredEndpoint ? (
                        <span className="font-mono">
                          {u.preferredEndpoint.label}
                          {u.preferredEndpoint.latencyMs !== null && ` · ${u.preferredEndpoint.latencyMs}ms`}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {u.expiresAt ? new Date(u.expiresAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          disabled={busyId === u.id}
                          onClick={() => toggleStatus(u)}
                          className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5"
                          title={u.status === "SUSPENDED" ? t("users.enable") : t("users.suspend")}
                        >
                          {u.status === "SUSPENDED" ? <Play size={15} /> : <Pause size={15} />}
                        </button>
                        <button
                          disabled={busyId === u.id}
                          onClick={() => regenerateConfig(u)}
                          className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5"
                          title={t("users.regenerateConfig")}
                        >
                          <RefreshCw size={15} />
                        </button>
                        <button
                          onClick={() => setPendingDelete(u.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-signal-rose hover:bg-signal-rose/10"
                          title={t("common.delete")}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
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
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`h-8 w-8 rounded-lg text-xs font-medium ${page === i + 1 ? "bg-ping-gradient text-white" : "text-slate-400 hover:bg-white/5"}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={t("common.delete")}
      />
    </div>
  );
}
