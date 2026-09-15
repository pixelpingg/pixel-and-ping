import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, Skeleton, UnavailableTag } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { DailyUsageCard } from "@/components/cloudflare/DailyUsageCard";
import { Power, PlugZap, Trash2, ExternalLink } from "lucide-react";

interface CfAccount {
  id: string; name: string; accountId: string; isActive: boolean; status: string;
  lastSyncAt: string | null; lastSyncError: string | null;
}

export default function Cloudflare() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<CfAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CfAccount | null>(null);
  const [zones, setZones] = useState<any[] | null>(null);
  const [workers, setWorkers] = useState<any>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/cloudflare/accounts");
      setAccounts(res.data.accounts);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load Cloudflare accounts"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function testConnection(a: CfAccount) {
    setBusyId(a.id);
    try {
      await api.post(`/cloudflare/accounts/${a.id}/test`);
      toast("success", "Connection healthy");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(a: CfAccount) {
    setBusyId(a.id);
    try {
      await api.post(`/cloudflare/accounts/${a.id}/toggle`);
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete(`/cloudflare/accounts/${pendingDelete}`);
      toast("success", "Account removed");
      setPendingDelete(null);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  async function openDetail(a: CfAccount) {
    setDetail(a);
    setZones(null);
    setWorkers(null);
    try {
      const [z, w] = await Promise.all([
        api.get(`/cloudflare/accounts/${a.id}/zones`),
        api.get(`/cloudflare/accounts/${a.id}/workers`),
      ]);
      setZones(z.data.zones);
      setWorkers(w.data.workers);
    } catch (err) {
      toast("error", getApiErrorMessage(err, "Could not load account details"));
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-semibold text-slate-50">{t("cloudflare.title")}</h1>

      <DailyUsageCard />

      {/* No "Add account" button — a deployment only ever runs under the
          Cloudflare account it was deployed with (CF_ACCOUNT_ID/CF_API_TOKEN
          in wrangler.toml/secrets), auto-detected above. Anything listed
          here is either that auto-detected account, or a leftover from
          before this was simplified — kept manageable (test/disable/delete)
          for cleanup, not as an "add more accounts" workflow. */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : accounts.length === 0 ? (
        <EmptyState title={t("common.noResults")} description="No Cloudflare account detected yet — configure CF_ACCOUNT_ID/CF_API_TOKEN and redeploy." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <div key={a.id} className="glass rounded-2xl p-5 space-y-3 hover:shadow-glow transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display font-semibold text-slate-100">{a.name}</h3>
                  <p className="text-xs text-slate-500 font-mono">{a.accountId}</p>
                </div>
                <Badge status={a.isActive ? a.status : "DISABLED"} />
              </div>
              {a.lastSyncError && <p className="text-xs text-signal-rose">{a.lastSyncError}</p>}
              <p className="text-xs text-slate-500">
                {t("cloudflare.lastSync")}: {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString() : <UnavailableTag />}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <Button size="sm" variant="secondary" icon={<PlugZap size={13} />} loading={busyId === a.id} onClick={() => testConnection(a)}>
                  {t("cloudflare.testConnection")}
                </Button>
                <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => openDetail(a)}>Details</Button>
                <button disabled={busyId === a.id} onClick={() => toggle(a)} className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5">
                  <Power size={14} />
                </button>
                <button onClick={() => setPendingDelete(a.id)} className="p-2 rounded-lg text-slate-400 hover:text-signal-rose hover:bg-signal-rose/10">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ""} wide>
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{t("cloudflare.zones")}</h4>
            {zones === null ? <Skeleton className="h-16" /> : zones.length === 0 ? (
              <p className="text-sm text-slate-500">No zones found on this account.</p>
            ) : (
              <div className="space-y-1.5">
                {zones.map((z) => (
                  <div key={z.id} className="flex items-center justify-between bg-white/[0.02] rounded-lg px-3 py-2 text-sm">
                    <span className="text-slate-300">{z.name}</span>
                    <Badge status={z.status === "active" ? "ACTIVE" : "UNKNOWN"} label={z.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{t("cloudflare.workers")}</h4>
            {workers === null ? <UnavailableTag /> : workers.length === 0 ? (
              <p className="text-sm text-slate-500">No workers deployed.</p>
            ) : (
              <div className="space-y-1.5">
                {workers.map((w: any) => (
                  <div key={w.id} className="bg-white/[0.02] rounded-lg px-3 py-2 text-sm text-slate-300 font-mono">{w.id}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} onConfirm={confirmDelete} title={t("common.delete")} />
    </div>
  );
}
