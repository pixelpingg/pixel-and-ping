import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { Plus, RefreshCw, Trash2, Star } from "lucide-react";

interface Endpoint {
  id: string; label: string; host: string; port: number; weight: number;
  isPrimary: boolean; health: string; score: number; latencyMs: number | null;
  server: { id: string; name: string };
}
interface Server { id: string; name: string; }

const emptyForm = { serverId: "", label: "", host: "", port: 443, weight: 100, isPrimary: false };

export default function Endpoints() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [ep, srv] = await Promise.all([api.get("/endpoints"), api.get("/servers")]);
      setEndpoints(ep.data.endpoints);
      setServers(srv.data.servers);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load endpoints"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/endpoints", form);
      toast("success", "Endpoint added");
      setModalOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function scan(id: string) {
    setScanningId(id);
    try {
      await api.post(`/endpoints/${id}/scan`);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setScanningId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete(`/endpoints/${pendingDelete}`);
      toast("success", "Endpoint removed");
      setPendingDelete(null);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("nav.endpoints")}</h1>
        <Button icon={<Plus size={16} />} onClick={() => setModalOpen(true)}>{t("common.create")}</Button>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? <TableSkeleton /> : error ? <ErrorState message={error} onRetry={load} /> : endpoints.length === 0 ? (
          <EmptyState description="Add endpoints to a server to enable health checks, scoring, and failover." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th className="px-4 py-3 text-start">Label</th>
                  <th className="px-4 py-3 text-start">Server</th>
                  <th className="px-4 py-3 text-start">Host:Port</th>
                  <th className="px-4 py-3 text-start">Weight</th>
                  <th className="px-4 py-3 text-start">{t("servers.latency")}</th>
                  <th className="px-4 py-3 text-start">{t("scanner.score")}</th>
                  <th className="px-4 py-3 text-start">Health</th>
                  <th className="px-4 py-3 text-end">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-slate-200 flex items-center gap-1.5">
                      {e.isPrimary && <Star size={13} className="text-signal-amber fill-signal-amber" />}
                      {e.label}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{e.server?.name}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{e.host}:{e.port}</td>
                    <td className="px-4 py-3 text-slate-400">{e.weight}%</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{e.latencyMs ? `${e.latencyMs}ms` : "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{e.score}</td>
                    <td className="px-4 py-3"><Badge status={e.health} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button disabled={scanningId === e.id} onClick={() => scan(e.id)} className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5">
                          <RefreshCw size={15} className={scanningId === e.id ? "animate-spin" : ""} />
                        </button>
                        <button onClick={() => setPendingDelete(e.id)} className="p-2 rounded-lg text-slate-400 hover:text-signal-rose hover:bg-signal-rose/10">
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("common.create")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("users.server")}</span>
            <select required className="input" value={form.serverId} onChange={(e) => setForm({ ...form, serverId: e.target.value })}>
              <option value="">—</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">Label</span>
            <input required className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("servers.host")}</span>
              <input required className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("servers.port")}</span>
              <input type="number" required className="input" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">Weight (%)</span>
            <input type="number" className="input" value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
            Primary endpoint
          </label>
          <Button type="submit" className="w-full" loading={saving}>{t("common.create")}</Button>
        </form>
      </Modal>

      <ConfirmDialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} onConfirm={confirmDelete} title={t("common.delete")} />
    </div>
  );
}
