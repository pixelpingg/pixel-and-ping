import { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-2xl shadow-glass ${className}`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  icon,
  hint,
  accent = "teal",
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: string;
  accent?: "teal" | "indigo" | "amber" | "rose";
}) {
  const ring = {
    teal: "bg-signal-teal/10 text-signal-teal",
    indigo: "bg-signal-indigo/10 text-signal-indigo",
    amber: "bg-signal-amber/10 text-signal-amber",
    rose: "bg-signal-rose/10 text-signal-rose",
  }[accent];

  return (
    <Card className="p-5 flex flex-col gap-3 hover:shadow-glow transition-shadow duration-300">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${ring}`}>{icon}</div>
      </div>
      <div className="font-display text-2xl font-semibold text-slate-50">{value}</div>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </Card>
  );
}
