import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "@/lib/api";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { Gauge } from "lucide-react";

interface SelfUsage {
  configured: boolean;
  requestsToday?: number;
  errorsToday?: number;
  dailyLimit?: number;
  percentUsed?: number;
}

/**
 * Backed by /api/cloudflare/self-usage — always the operator's own
 * account (CF_ACCOUNT_ID/CF_API_TOKEN, deploy-time secrets, auto-detected
 * by ensureSelfAccount server-side). No "add account" step, no per-
 * account picker: one deployment, one Cloudflare account, one number.
 */
export function DailyUsageCard() {
  const [usage, setUsage] = useState<SelfUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/cloudflare/self-usage");
      setUsage(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <Skeleton className="h-28" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!usage?.configured) {
    return (
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Gauge size={16} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-300">Daily Cloudflare usage</h3>
        </div>
        <p className="text-xs text-slate-500">
          Not configured yet — set <code className="text-slate-400">CF_ACCOUNT_ID</code> in wrangler.toml and run
          <code className="text-slate-400"> wrangler secret put CF_API_TOKEN</code> once, then redeploy. No "add account" step needed —
          this is always your own account, the one you deployed with.
        </p>
      </div>
    );
  }

  const pct = usage.percentUsed ?? 0;
  const barColor = pct >= 90 ? "bg-signal-rose" : pct >= 70 ? "bg-signal-amber" : "bg-signal-teal";

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">Daily Cloudflare usage</h3>
        </div>
        <span className="text-xs text-slate-500">resets at 00:00 UTC</span>
      </div>
      <div className="flex items-end justify-between mb-2">
        <span className="text-2xl font-display font-semibold text-slate-50">
          {usage.requestsToday?.toLocaleString()} <span className="text-sm text-slate-500 font-normal">/ {usage.dailyLimit?.toLocaleString()} requests</span>
        </span>
        <span className="text-sm font-mono text-slate-400">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {(usage.errorsToday ?? 0) > 0 && (
        <p className="text-xs text-signal-rose mt-2">{usage.errorsToday?.toLocaleString()} errors today</p>
      )}
    </div>
  );
}
