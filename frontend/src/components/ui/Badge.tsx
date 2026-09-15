const MAP: Record<string, string> = {
  ACTIVE: "bg-signal-teal/10 text-signal-teal border-signal-teal/30",
  ONLINE: "bg-signal-teal/10 text-signal-teal border-signal-teal/30",
  HEALTHY: "bg-signal-teal/10 text-signal-teal border-signal-teal/30",
  EXCELLENT: "bg-signal-teal/10 text-signal-teal border-signal-teal/30",
  GOOD: "bg-signal-indigo/10 text-signal-indigo border-signal-indigo/30",
  FAIR: "bg-signal-amber/10 text-signal-amber border-signal-amber/30",
  DISABLED: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  OFFLINE: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  UNKNOWN: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  SUSPENDED: "bg-signal-rose/10 text-signal-rose border-signal-rose/30",
  EXPIRED: "bg-signal-rose/10 text-signal-rose border-signal-rose/30",
  UNHEALTHY: "bg-signal-rose/10 text-signal-rose border-signal-rose/30",
  POOR: "bg-signal-rose/10 text-signal-rose border-signal-rose/30",
  DEGRADED: "bg-signal-amber/10 text-signal-amber border-signal-amber/30",
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const cls = MAP[status] ?? "bg-slate-500/10 text-slate-400 border-slate-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? status}
    </span>
  );
}
