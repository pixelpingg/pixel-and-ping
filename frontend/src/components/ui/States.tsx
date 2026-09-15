import { ReactNode } from "react";
import { Inbox, AlertCircle, RotateCw } from "lucide-react";
import { Button } from "./Button";
import { useTranslation } from "react-i18next";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse-slow rounded-lg bg-base-700/60 ${className}`} />;
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title?: string; description?: string; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="h-14 w-14 rounded-2xl bg-base-700/60 flex items-center justify-center mb-4">
        <Inbox size={22} className="text-slate-500" />
      </div>
      <h4 className="font-display text-base font-semibold text-slate-200">{title ?? t("common.noResults")}</h4>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="h-14 w-14 rounded-2xl bg-signal-rose/10 flex items-center justify-center mb-4">
        <AlertCircle size={22} className="text-signal-rose" />
      </div>
      <h4 className="font-display text-base font-semibold text-slate-200">{message}</h4>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry} icon={<RotateCw size={14} />}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

export function UnavailableTag() {
  const { t } = useTranslation();
  return <span className="text-xs text-slate-500 italic">{t("dashboard.unavailable")}</span>;
}
