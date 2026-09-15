import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/store/AuthContext";
import {
  LayoutDashboard, Users, Server, Waypoints, Radar, Plug, Cloud, FileCode2,
  Activity, BarChart3, ShieldAlert, ScrollText, Bell, Settings, X, Crown,
} from "lucide-react";

const items = [
  { to: "/", icon: LayoutDashboard, key: "dashboard", end: true },
  { to: "/users", icon: Users, key: "users" },
  { to: "/servers", icon: Server, key: "servers" },
  { to: "/endpoints", icon: Waypoints, key: "endpoints" },
  { to: "/ip-scanner", icon: Radar, key: "ipScanner" },
  { to: "/ports", icon: Plug, key: "ports" },
  { to: "/cloudflare", icon: Cloud, key: "cloudflare" },
  { to: "/config-generator", icon: FileCode2, key: "configGenerator" },
  { to: "/traffic", icon: Activity, key: "traffic" },
  { to: "/analytics", icon: BarChart3, key: "analytics" },
  { to: "/failover", icon: ShieldAlert, key: "failover" },
  { to: "/logs", icon: ScrollText, key: "logs" },
  { to: "/notifications", icon: Bell, key: "notifications" },
  { to: "/settings", icon: Settings, key: "settings" },
];

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { admin } = useAuth();
  // Not just hidden with CSS — this item literally does not exist in the
  // DOM for anyone but a SUPER_ADMIN, and the route itself (App.tsx) and
  // the API behind it (analytics.ts's /owner-overview) both re-check the
  // same role independently, so this isn't just a UI nicety a curious
  // ADMIN/VIEWER could bypass by guessing the URL.
  const visibleItems = admin?.role === "SUPER_ADMIN" ? [...items, { to: "/owner", icon: Crown, key: "owner" }] : items;

  const content = (
    <nav className="flex flex-col gap-1 p-3">
      {visibleItems.map(({ to, icon: Icon, key, end }) => (
        <NavLink
          key={key}
          to={to}
          end={end}
          onClick={onClose}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isActive ? "bg-ping-gradient text-white shadow-glow" : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
            }`
          }
        >
          <Icon size={17} />
          <span>{t(`nav.${key}`)}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <>
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 glass border-e border-white/5 h-screen sticky top-0 overflow-y-auto">
        <BrandMark />
        {content}
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <div className="relative w-72 glass h-full overflow-y-auto">
            <div className="flex items-center justify-between px-4 pt-4">
              <BrandMark compact />
              <button onClick={onClose} className="text-slate-400 p-2"><X size={18} /></button>
            </div>
            {content}
          </div>
        </div>
      )}
    </>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 px-5 ${compact ? "py-2" : "py-5"}`}>
      <div className="relative h-9 w-9 shrink-0 brand-live"><img src="/pixel-ping-logo.png" alt="Pixel & Ping" className="brand-logo h-9 w-9 rounded-xl" /></div>
      <div className="leading-tight">
        <div className="font-display font-semibold text-slate-50 text-sm">Pixel &amp; Ping</div>
        <div className="text-[10px] text-slate-500 font-mono">v1.1.1</div>
      </div>
    </div>
  );
}
