import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { Plus, HeartPulse, Power, Trash2, Pencil } from "lucide-react";

interface Server {
  id: string; name: string; host: string; port: number; protocol: string;
  location: string | null; status: string; isEnabled: boolean;
  _count?: { users: number; endpoints: number };
}

const emptyForm = { name: "", host: "", port: 443, protocol: "vless", location: "" };

export default function Servers() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Server | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/servers");
      setServers(res.data.servers);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load servers"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(s: Server) {
    setEditing(s);
    setForm({ name: s.name, host: s.host, port: s.port, protocol: s.protocol, location: s.location ?? "" });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/servers/${editing.id}`, form);
        toast("success", "Server updated");
      } else {
        await api.post("/servers", form);
        toast("success", "Server created");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: Server) {
    setBusyId(s.id);
    try {
      await api.post(`/servers/${s.id}/toggle`);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function healthCheck(s: Server) {
    setBusyId(s.id);
    try {
      await api.post(`/servers/${s.id}/health-check`);
      toast("success", "Health check complete");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err, "No endpoints configured for this server yet"));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete(`/servers/${pendingDelete}`);
      toast("success", "Server deleted");
      setPendingDelete(null);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("servers.title")}</h1>
        <Button icon={<Plus size={16} />} onClick={openCreate}>{t("servers.addServer")}</Button>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? <TableSkeleton /> : error ? <ErrorState message={error} onRetry={load} /> : servers.length === 0 ? (
          <EmptyState description="Register a server to start assigning users and endpoints." action={<Button size="sm" icon={<Plus size={14} />} onClick={openCreate}>{t("servers.addServer")}</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th className="px-4 py-3 text-start">{t("servers.title")}</th>
                  <th className="px-4 py-3 text-start">{t("servers.host")}</th>
                  <th className="px-4 py-3 text-start">{t("servers.protocol")}</th>
                  <th className="px-4 py-3 text-start">{t("servers.location")}</th>
                  <th className="px-4 py-3 text-start">Users</th>
                  <th className="px-4 py-3 text-start">{t("common.status")}</th>
                  <th className="px-4 py-3 text-end">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-slate-200">{s.name}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{s.host}:{s.port}</td>
                    <td className="px-4 py-3 text-slate-400 uppercase text-xs">{s.protocol}</td>
                    <td className="px-4 py-3 text-slate-400">{s.location ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{s._count?.users ?? 0}</td>
                    <td className="px-4 py-3"><Badge status={s.isEnabled ? s.status : "DISABLED"} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button disabled={busyId === s.id} onClick={() => healthCheck(s)} className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5" title={t("servers.healthCheck")}>
                          <HeartPulse size={15} />
                        </button>
                        <button disabled={busyId === s.id} onClick={() => toggle(s)} className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5" title={s.isEnabled ? t("common.disabled") : t("common.enabled")}>
                          <Power size={15} />
                        </button>
                        <button onClick={() => openEdit(s)} className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5" title={t("common.edit")}>
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => setPendingDelete(s.id)} className="p-2 rounded-lg text-slate-400 hover:text-signal-rose hover:bg-signal-rose/10" title={t("common.delete")}>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t("common.edit") : t("servers.addServer")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <F label={t("servers.title")}><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label={t("servers.host")}><input required className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></F>
            <F label={t("servers.port")}><input type="number" required className="input" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label={t("servers.protocol")}>
              <select className="input" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
                <option value="vless">VLESS</option>
                <option value="trojan">Trojan</option>
              </select>
            </F>
            <F label={t("servers.location")}><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></F>
          </div>
          <Button type="submit" className="w-full" loading={saving}>{t("common.save")}</Button>
        </form>
      </Modal>

      <ConfirmDialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} onConfirm={confirmDelete} title={t("common.delete")} />
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-medium text-slate-400 mb-1.5 block">{label}</span>{children}</label>;
}
