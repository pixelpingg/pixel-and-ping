import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/store/ToastContext";
import { Skeleton } from "@/components/ui/States";
import { KeyRound, Palette, ShieldCheck, Save, UserRound, LockKeyhole } from "lucide-react";
import { SUPPORTED_LANGUAGES, changeLanguage } from "@/i18n";
import { useAuth } from "@/store/AuthContext";
import { TwoFactorPanel } from "@/components/settings/TwoFactorPanel";
import { ApiKeysPanel } from "@/components/settings/ApiKeysPanel";
import { Avatar, AvatarPicker } from "@/components/ui/AvatarPicker";
import { ThemeName, useTheme } from "@/store/ThemeContext";

const themes: { id: ThemeName; title: string; note: string }[] = [
  { id: "neon", title: "Pixel Neon", note: "Animated blue → purple brand accent" },
  { id: "dark", title: "Dark", note: "Clean low-light workspace" },
  { id: "light", title: "Light", note: "Bright professional workspace" },
  { id: "midnight", title: "Midnight", note: "Deep black / indigo" },
];

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { admin, updateAvatar } = useAuth();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(admin?.avatarUrl ?? null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  async function load() {
    setLoading(true);
    try { const res = await api.get("/settings"); setSettings(res.data.settings); }
    catch (err) { toast("error", getApiErrorMessage(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveKey(key: string, value: unknown) {
    setSaving(true);
    try { await api.put(`/settings/${key}`, { value }); setSettings((s) => ({ ...s, [key]: value })); toast("success", "Saved"); }
    catch (err) { toast("error", getApiErrorMessage(err)); }
    finally { setSaving(false); }
  }

  async function saveAvatar() {
    try { await updateAvatar(avatar); toast("success", "Profile avatar updated"); }
    catch (err) { toast("error", getApiErrorMessage(err)); }
  }

  async function changePassword() {
    if (newPassword.length < 8) return toast("error", "New password must be at least 8 characters");
    if (newPassword !== confirmPassword) return toast("error", "New passwords do not match");
    setChangingPassword(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast("success", "Password changed successfully");
    } catch (err) { toast("error", getApiErrorMessage(err)); }
    finally { setChangingPassword(false); }
  }

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-50">{t("settings.title")}</h1>
        <p className="text-sm text-slate-500 mt-1">Personalize your workspace without touching the Cloudflare runtime.</p>
      </div>

      <section className="glass glass-hover rounded-3xl p-6">
        <div className="flex items-center gap-3 mb-5"><span className="h-9 w-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan"><UserRound size={18} /></span><div><h3 className="font-display text-sm font-semibold text-slate-200">Profile</h3><p className="text-xs text-slate-500">Choose an avatar or upload your own image.</p></div></div>
        <div className="flex flex-col md:flex-row gap-6 md:items-start">
          <div className="shrink-0 flex items-center gap-3"><Avatar src={avatar} size={72} fallback={admin?.username?.[0]?.toUpperCase() ?? "P"} /><div><div className="text-sm font-medium text-slate-200">{admin?.username}</div><div className="text-xs text-slate-500">{admin?.role}</div></div></div>
          <div className="flex-1"><AvatarPicker value={avatar} onChange={setAvatar} /><div className="mt-3"><Button icon={<Save size={15} />} onClick={saveAvatar}>Save avatar</Button></div></div>
        </div>
      </section>

      <section className="glass glass-hover rounded-3xl p-6">
        <div className="flex items-center gap-3 mb-5"><span className="h-9 w-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan"><Palette size={18} /></span><div><h3 className="font-display text-sm font-semibold text-slate-200">Appearance</h3><p className="text-xs text-slate-500">Pixel Neon is the recommended brand theme.</p></div></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {themes.map((item) => <button key={item.id} type="button" onClick={() => setTheme(item.id)} className={`text-start rounded-2xl p-4 border transition-all ${theme === item.id ? "border-brand-cyan/60 bg-brand-cyan/10 shadow-[0_0_28px_rgba(51,155,251,.10)]" : "border-white/5 hover:border-white/15 bg-white/[.02]"}`}><div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-200">{item.title}</span>{theme === item.id && <span className="h-2 w-2 rounded-full bg-brand-cyan shadow-[0_0_10px_#339BFB]" />}</div><p className="text-[11px] text-slate-500 mt-1">{item.note}</p></button>)}
        </div>
      </section>

      <section className="glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan"><GlobeIcon /></span><div><h3 className="font-display text-sm font-semibold text-slate-200">{t("settings.general")}</h3><p className="text-xs text-slate-500">Regional and panel preferences.</p></div></div>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="text-xs text-slate-400 mb-1.5 block">Language</label><select className="input" value={i18n.language} onChange={(e) => changeLanguage(e.target.value)}>{SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></div>
          <div><label className="text-xs text-slate-400 mb-1.5 block">Panel</label><div className="input flex items-center justify-between"><span>Pixel &amp; Ping</span><span className="text-[10px] font-mono text-slate-500">v1.1.1</span></div></div>
        </div>
      </section>

      <section className="glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan"><LockKeyhole size={18} /></span><div><h3 className="font-display text-sm font-semibold text-slate-200">Change password</h3><p className="text-xs text-slate-500">Your new password is stored as a secure hash; it is never shown back to the browser.</p></div></div>
        <div className="grid md:grid-cols-3 gap-3"><input className="input" type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /><input className="input" type="password" placeholder="New password (8+ chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><input className="input" type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
        <Button loading={changingPassword} onClick={changePassword}>Change password</Button>
      </section>

      <section className="glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan"><ShieldCheck size={18} /></span><div><h3 className="font-display text-sm font-semibold text-slate-200">{t("settings.security")}</h3><p className="text-xs text-slate-500">Session and two-factor protection.</p></div></div>
        <div className="flex items-center justify-between"><span className="text-sm text-slate-300">Session timeout</span><select className="input w-40" value={settings.sessionTimeoutMinutes ?? 60} onChange={(e) => saveKey("sessionTimeoutMinutes", Number(e.target.value))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 hour</option><option value={480}>8 hours</option></select></div>
        <div className="pt-3 border-t border-white/5"><TwoFactorPanel /></div>
      </section>

      <section className="glass rounded-3xl p-6 space-y-4"><div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan"><KeyRound size={18} /></span><div><h3 className="font-display text-sm font-semibold text-slate-200">Ingestion API Keys</h3><p className="text-xs text-slate-500">Manage machine-to-panel ingestion credentials.</p></div></div><ApiKeysPanel /></section>

      <section className="glass rounded-3xl p-6"><h3 className="font-display text-sm font-semibold text-slate-200">Monitoring</h3><p className="text-sm text-slate-500 mt-1">Health-check interval is configured under Failover. Analytics only display data actually recorded by the system.</p></section>
    </div>
  );
}
function GlobeIcon(){ return <span className="text-sm">🌐</span>; }
