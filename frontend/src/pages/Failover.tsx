import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { Save, Zap } from "lucide-react";

interface Settings {
  id: string; enabled: boolean; failureThreshold: number; retryCount: number;
  healthCheckIntervalSec: number; recoveryThreshold: number; strategy: string;
}
interface FailoverEvent {
  id: string; reason: string; triggeredAt: string; automatic: boolean;
  fromEndpoint: { label: string } | null; toEndpoint: { label: string } | null;
}

export default function Failover() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [events, setEvents] = useState<FailoverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, e] = await Promise.all([api.get("/failover/settings"), api.get("/failover/events")]);
      setSettings(s.data.settings);
      setEvents(e.data.events);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await api.patch("/failover/settings", {
        enabled: settings.enabled,
        failureThreshold: settings.failureThreshold,
        retryCount: settings.retryCount,
        healthCheckIntervalSec: settings.healthCheckIntervalSec,
        recoveryThreshold: settings.recoveryThreshold,
        strategy: settings.strategy,
      });
      setSettings(res.data.settings);
      toast("success", t("common.save"));
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function evaluateNow() {
    setEvaluating(true);
    try {
      await api.post("/failover/evaluate");
      toast("success", "Failover evaluation complete");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setEvaluating(false);
    }
  }

  if (loading) return <Skeleton className="h-96" />;
  if (error || !settings) return <ErrorState message={error ?? "No data"} onRetry={load} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("failover.title")}</h1>
        <Button variant="secondary" icon={<Zap size={15} />} loading={evaluating} onClick={evaluateNow}>Evaluate now</Button>
      </div>

      <div className="glass rounded-2xl p-6 space-y-5">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">{t("failover.enable")}</span>
          <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} className="h-5 w-5" />
        </label>

        <div className="grid sm:grid-cols-2 gap-4">
          <NumField label={t("failover.failureThreshold")} value={settings.failureThreshold} onChange={(v) => setSettings({ ...settings, failureThreshold: v })} />
          <NumField label={t("failover.retryCount")} value={settings.retryCount} onChange={(v) => setSettings({ ...settings, retryCount: v })} />
          <NumField label={t("failover.healthCheckInterval")} value={settings.healthCheckIntervalSec} onChange={(v) => setSettings({ ...settings, healthCheckIntervalSec: v })} />
          <NumField label={t("failover.recoveryThreshold")} value={settings.recoveryThreshold} onChange={(v) => setSettings({ ...settings, recoveryThreshold: v })} />
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-400 mb-1.5 block">{t("failover.strategy")}</span>
          <select className="input" value={settings.strategy} onChange={(e) => setSettings({ ...settings, strategy: e.target.value })}>
            <option value="ROUND_ROBIN">Round Robin</option>
            <option value="LEAST_LATENCY">Least Latency</option>
            <option value="WEIGHTED">Weighted</option>
            <option value="HEALTH_BASED">Health-based</option>
          </select>
        </label>

        <Button icon={<Save size={15} />} loading={saving} onClick={save}>{t("common.save")}</Button>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <h3 className="font-display text-sm font-semibold text-slate-200 px-5 py-4 border-b border-white/5">Failover history</h3>
        {events.length === 0 ? (
          <EmptyState description="No failover events have occurred yet." />
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((e) => (
              <div key={e.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div>
                  <div className="text-slate-200">{e.fromEndpoint?.label ?? "—"} → {e.toEndpoint?.label ?? "—"}</div>
                  <div className="text-xs text-slate-500">{e.reason}</div>
                </div>
                <div className="text-end">
                  <Badge status={e.automatic ? "ACTIVE" : "UNKNOWN"} label={e.automatic ? "Automatic" : "Manual"} />
                  <div className="text-xs text-slate-500 mt-1 font-mono">{new Date(e.triggeredAt).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400 mb-1.5 block">{label}</span>
      <input type="number" className="input" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
