import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { Plus, CheckCircle2, Trash2 } from "lucide-react";

interface Port { id: string; number: number; type: string; label: string | null; isReserved: boolean; isActive: boolean; }

export default function Ports() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [ports, setPorts] = useState<Port[]>([]);
  const [presets, setPresets] = useState<{ tls: number[]; nonTls: number[] }>({ tls: [], nonTls: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ number: "", type: "CUSTOM", label: "" });
  const [saving, setSaving] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/ports");
      setPorts(res.data.ports);
      setPresets(res.data.presets);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load ports"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/ports", { number: Number(form.number), type: form.type, label: form.label || undefined });
      toast("success", "Port registered");
      setModalOpen(false);
      setForm({ number: "", type: "CUSTOM", label: "" });
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function validate(p: Port) {
    setValidatingId(p.id);
    try {
      const res = await api.post(`/ports/${p.id}/validate`);
      toast(res.data.bindable ? "success" : "error", res.data.bindable ? "Port is bindable and now active" : "Port failed the bind check");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setValidatingId(null);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/ports/${id}`);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  const tlsPorts = ports.filter((p) => p.type === "TLS");
  const nonTlsPorts = ports.filter((p) => p.type === "NON_TLS");
  const customPorts = ports.filter((p) => p.type === "CUSTOM");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("nav.ports")}</h1>
        <Button icon={<Plus size={16} />} onClick={() => setModalOpen(true)}>{t("common.create")}</Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <PortGroup title="TLS Ports" ports={tlsPorts} onValidate={validate} onRemove={remove} validatingId={validatingId} />
          <PortGroup title="Non-TLS Ports" ports={nonTlsPorts} onValidate={validate} onRemove={remove} validatingId={validatingId} />
          <PortGroup title="Custom Ports" ports={customPorts} onValidate={validate} onRemove={remove} validatingId={validatingId} />
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("common.create")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("servers.port")}</span>
            <input type="number" required min={1} max={65535} className="input" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">Type</span>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="TLS">TLS</option>
              <option value="NON_TLS">Non-TLS</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">Label</span>
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <Button type="submit" className="w-full" loading={saving}>{t("common.create")}</Button>
        </form>
      </Modal>
    </div>
  );
}

function PortGroup({ title, ports, onValidate, onRemove, validatingId }: {
  title: string; ports: Port[]; onValidate: (p: Port) => void; onRemove: (id: string) => void; validatingId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="glass rounded-2xl p-4">
      <h3 className="font-display text-sm font-semibold text-slate-200 mb-3">{title}</h3>
      {ports.length === 0 ? (
        <EmptyState description="No ports registered." />
      ) : (
        <div className="space-y-2">
          {ports.map((p) => (
            <div key={p.id} className="flex items-center justify-between bg-white/[0.02] rounded-xl px-3 py-2">
              <div>
                <div className="font-mono text-sm text-slate-200">{p.number}</div>
                {p.label && <div className="text-[11px] text-slate-500">{p.label}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge status={p.isActive ? "ACTIVE" : "OFFLINE"} label={p.isActive ? t("common.enabled") : t("common.disabled")} />
                <button disabled={validatingId === p.id} onClick={() => onValidate(p)} className="p-1.5 rounded-lg text-slate-400 hover:text-signal-teal hover:bg-white/5">
                  <CheckCircle2 size={15} />
                </button>
                {!p.isReserved && (
                  <button onClick={() => onRemove(p.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-signal-rose hover:bg-signal-rose/10">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
