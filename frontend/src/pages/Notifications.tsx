import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { useAuth } from "@/store/AuthContext";
import { localizedNotificationText, type NotificationRow } from "@/lib/notifications";
import { CheckCheck, Info, AlertTriangle, XCircle, AlertOctagon, Megaphone } from "lucide-react";

const ICONS: Record<string, any> = { INFO: Info, WARNING: AlertTriangle, ERROR: XCircle, CRITICAL: AlertOctagon };
const COLORS: Record<string, string> = {
  INFO: "text-signal-indigo bg-signal-indigo/10",
  WARNING: "text-signal-amber bg-signal-amber/10",
  ERROR: "text-signal-rose bg-signal-rose/10",
  CRITICAL: "text-signal-rose bg-signal-rose/10",
};
const LOCALES = [
  { code: "en", flag: "🇬🇧", label: "English" },
  { code: "fa", flag: "🇮🇷", label: "فارسی" },
  { code: "ru", flag: "🇷🇺", label: "Русский" },
  { code: "zh", flag: "🇨🇳", label: "中文" },
];

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { admin } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/notifications");
      setItems(res.data.notifications);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function markAllRead() {
    await api.post("/notifications/read-all");
    load();
  }

  async function markRead(id: string) {
    await api.post(`/notifications/${id}/read`);
    load();
  }

  async function sendBroadcast(e: React.FormEvent) {
    e.preventDefault();
    const filledTitles = Object.fromEntries(Object.entries(titles).filter(([, v]) => v.trim()));
    const filledMessages = Object.fromEntries(Object.entries(messages).filter(([, v]) => v.trim()));
    if (Object.keys(filledTitles).length === 0 || Object.keys(filledMessages).length === 0) {
      toast("error", "Fill in at least one language's title and message.");
      return;
    }
    setSending(true);
    try {
      await api.post("/notifications/broadcast", { titles: filledTitles, messages: filledMessages });
      toast("success", "Broadcast sent — everyone signed in will see it.");
      setTitles({});
      setMessages({});
      setComposerOpen(false);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("nav.notifications")}</h1>
        <div className="flex gap-2">
          {admin?.role === "SUPER_ADMIN" && (
            <Button variant="secondary" size="sm" icon={<Megaphone size={14} />} onClick={() => setComposerOpen((v) => !v)}>
              Broadcast
            </Button>
          )}
          <Button variant="secondary" size="sm" icon={<CheckCheck size={14} />} onClick={markAllRead}>Mark all read</Button>
        </div>
      </div>

      {/* SUPER_ADMIN-only — the ability to push a message to every admin
          signed into this panel is deliberately restricted to the same
          role that gates the owner-only overview (see OwnerOverview.tsx),
          not exposed to every admin account. */}
      {composerOpen && admin?.role === "SUPER_ADMIN" && (
        <form onSubmit={sendBroadcast} className="glass rounded-2xl p-5 space-y-4">
          <p className="text-xs text-slate-500">
            Write the message in as many languages as you want — each admin sees it in their own selected UI language,
            falling back to the first one you fill in if theirs is missing.
          </p>
          {LOCALES.map((l) => (
            <div key={l.code} className="grid grid-cols-[auto_1fr] gap-3 items-start">
              <span className="text-lg pt-2">{l.flag}</span>
              <div className="space-y-2">
                <input
                  className="input"
                  placeholder={`${l.label} — title`}
                  value={titles[l.code] ?? ""}
                  onChange={(e) => setTitles({ ...titles, [l.code]: e.target.value })}
                />
                <textarea
                  className="input min-h-[60px]"
                  placeholder={`${l.label} — message`}
                  value={messages[l.code] ?? ""}
                  onChange={(e) => setMessages({ ...messages, [l.code]: e.target.value })}
                />
              </div>
            </div>
          ))}
          <Button type="submit" className="w-full" loading={sending}>Send to everyone</Button>
        </form>
      )}

      {loading ? <Skeleton className="h-64" /> : error ? <ErrorState message={error} onRetry={load} /> : items.length === 0 ? (
        <EmptyState description="You're all caught up." />
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const Icon = ICONS[n.level] ?? Info;
            return (
              <div key={n.id} className={`glass rounded-xl p-4 flex gap-3 ${n.isRead ? "opacity-60" : ""}`} onClick={() => !n.isRead && markRead(n.id)}>
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${COLORS[n.level] ?? ""}`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-slate-100">{localizedNotificationText(n, "titles", i18n.language)}</h4>
                    <span className="text-xs text-slate-500 font-mono">{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-400 mt-0.5">{localizedNotificationText(n, "messages", i18n.language)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
