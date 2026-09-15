import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu, Github, Send, Youtube, Globe, LogOut, User as UserIcon, Bell, ChevronDown } from "lucide-react";
import { useAuth } from "@/store/AuthContext";
import { useToast } from "@/store/ToastContext";
import { api } from "@/lib/api";
import { localizedNotificationText, type NotificationRow } from "@/lib/notifications";
import { changeLanguage, SUPPORTED_LANGUAGES } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/ui/AvatarPicker";

const LINKS = { github: "https://github.com/samyarahad", telegram: "https://t.me/Pixel_Ping", youtube: "https://youtube.com/@pixel_ping_024" };
const FLAGS: Record<string,string> = { en:"🇬🇧", fa:"🇮🇷", ru:"🇷🇺", zh:"🇨🇳" };

// Polling, not a WebSocket/SSE stream — this Worker is stateless per
// request, and a real push channel would need Durable Objects to hold
// the connection open. 20s keeps the bell feeling live without hammering
// D1, which is the honest tradeoff for a panel this size.
const NOTIFICATION_POLL_MS = 20000;


export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { t, i18n } = useTranslation();
  const { admin, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [langOpen, setLangOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const seenIds = useRef<Set<string> | null>(null); // null = first poll not done yet
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await api.get("/notifications", { params: { unreadOnly: true } });
        const rows: NotificationRow[] = res.data.notifications;
        if (cancelled) return;
        setUnreadCount(rows.length);
        if (seenIds.current === null) {
          // First load after mount/refresh: just baseline the seen set —
          // don't fire a toast for every unread item already waiting,
          // only for ones that arrive while the panel is open.
          seenIds.current = new Set(rows.map((r) => r.id));
          return;
        }
        const fresh = rows.filter((r) => !seenIds.current!.has(r.id));
        for (const n of fresh) {
          seenIds.current.add(n.id);
          toast("info", `${localizedNotificationText(n, "titles", i18n.language)} — ${localizedNotificationText(n, "messages", i18n.language)}`);
        }
      } catch {
        /* transient — next poll retries */
      }
    }
    poll();
    const id = setInterval(poll, NOTIFICATION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // i18n.language is intentionally in deps: a language switch mid-session
    // should localize the *next* toast without needing a full reload.
  }, [i18n.language]);

  return (
    <header className="sticky top-0 z-30 bg-[color:var(--pp-surface-strong)]/75 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center justify-between px-4 lg:px-6 h-[68px]">
        <div className="flex items-center gap-3">
          <button onClick={onMenuClick} className="lg:hidden text-slate-300 p-2 -ms-2"><Menu size={20} /></button>
          <div className="hidden sm:flex items-center gap-2">
            <span className="font-display font-semibold text-slate-50">Pixel &amp; Ping</span>
            <span className="font-mono text-[10px] text-slate-400 bg-white/5 border border-white/5 px-2 py-1 rounded-full">v1.1.1</span>
          </div>
          <div className="hidden md:flex items-center gap-1 ms-3 border-s border-white/5 ps-3">
            <IconLink href={LINKS.github} label="GitHub"><Github size={15} /></IconLink>
            <IconLink href={LINKS.telegram} label="Telegram"><Send size={15} /></IconLink>
            <IconLink href={LINKS.youtube} label="YouTube"><Youtube size={15} /></IconLink>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setLangOpen((v) => !v)} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-300 hover:bg-white/5 border border-transparent hover:border-white/5">
              <span className="text-base leading-none">{FLAGS[i18n.language] ?? "🌐"}</span><span className="hidden sm:inline">{lang.label}</span><ChevronDown size={13} />
            </button>
            {langOpen && <div className="absolute end-0 mt-2 w-44 glass rounded-2xl shadow-glass overflow-hidden p-1">
              {SUPPORTED_LANGUAGES.map((l) => <button key={l.code} onClick={() => { changeLanguage(l.code); setLangOpen(false); }} className="w-full text-start px-3 py-2.5 text-sm text-slate-300 hover:bg-white/5 rounded-xl flex items-center gap-3"><span className="text-lg">{FLAGS[l.code]}</span><span>{l.label}</span></button>)}
            </div>}
          </div>

          <button onClick={() => navigate("/notifications")} className="p-2.5 rounded-xl text-slate-300 hover:bg-white/5 relative">
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-signal-rose text-white text-[10px] font-semibold flex items-center justify-center animate-pulse">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          <div className="relative">
            <button onClick={() => setProfileOpen((v) => !v)} className="flex items-center gap-2 ps-1 pe-2 py-1 rounded-full hover:bg-white/5">
              <Avatar src={admin?.avatarUrl} size={34} fallback={admin?.username?.[0]?.toUpperCase() ?? "P"} />
              <span className="hidden sm:inline text-sm text-slate-300 max-w-28 truncate">{admin?.username}</span>
              <ChevronDown className="hidden sm:block text-slate-500" size={14} />
            </button>
            {profileOpen && <div className="absolute end-0 mt-2 w-56 glass rounded-2xl shadow-glass overflow-hidden p-1">
              <button onClick={() => { setProfileOpen(false); navigate("/settings"); }} className="w-full text-start px-3 py-3 hover:bg-white/5 rounded-xl flex items-center gap-3">
                <Avatar src={admin?.avatarUrl} size={38} fallback={admin?.username?.[0]?.toUpperCase() ?? "P"} />
                <span className="min-w-0"><span className="block text-sm text-slate-200 truncate">{admin?.username}</span><span className="block text-[11px] text-slate-500">{admin?.role}</span></span>
              </button>
              <div className="h-px bg-white/5 my-1" />
              <button onClick={() => logout().then(() => navigate("/login"))} className="w-full text-start px-3 py-2.5 text-sm text-signal-rose hover:bg-white/5 rounded-xl flex items-center gap-2"><LogOut size={14} /> {t("auth.signOut")}</button>
            </div>}
          </div>
        </div>
      </div>
    </header>
  );
}

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-white/5 transition-colors">{children}</a>;
}
