import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/store/AuthContext";
import { Button } from "@/components/ui/Button";
import { LockKeyhole, ShieldCheck } from "lucide-react";

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await login(password, useRecovery ? undefined : totpCode || undefined, useRecovery ? recoveryCode : undefined);
      if (result.requiresTwoFactor) {
        setNeedsTwoFactor(true);
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.invalidCredentials"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-radar-grid pointer-events-none" />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="relative h-20 w-20 mb-4 brand-live"><img src="/pixel-ping-logo.png" alt="Pixel & Ping" className="brand-logo h-20 w-20 rounded-2xl" /></div>
          <h1 className="font-display text-xl font-semibold text-slate-50">Pixel &amp; Ping</h1>
          <p className="text-xs text-slate-500 mt-1">{t("app.tagline")}</p>
        </div>

        <div className="glass rounded-2xl shadow-glass p-6">
          <h2 className="font-display text-base font-semibold text-slate-100 mb-5">{t("auth.loginTitle")}</h2>

          {error && (
            <div className="mb-4 rounded-xl bg-signal-rose/10 border border-signal-rose/30 text-signal-rose text-sm px-3 py-2">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!needsTwoFactor ? (
              <>
                <Field icon={<LockKeyhole size={15} />} label={t("auth.password")}>
                  <div className="mb-2 rounded-lg border border-signal-teal/20 bg-signal-teal/5 px-3 py-2 text-xs text-slate-300">
                    <span className="text-slate-500">{t("auth.defaultPassword")}</span> <strong className="font-mono text-slate-100">admin</strong>
                    <div className="mt-1 text-[11px] text-slate-500">{t("auth.defaultPasswordWarning")}</div>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input"
                    placeholder="••••••••"
                    required
                  />
                </Field>
              </>
            ) : (
              <>
                <Field icon={<ShieldCheck size={15} />} label={useRecovery ? "Recovery code" : t("auth.twoFactorCode")}>
                  <input
                    autoFocus
                    value={useRecovery ? recoveryCode : totpCode}
                    onChange={(e) => (useRecovery ? setRecoveryCode(e.target.value) : setTotpCode(e.target.value))}
                    className="input tracking-[0.3em] text-center font-mono"
                    maxLength={useRecovery ? 10 : 6}
                    required
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => setUseRecovery((v) => !v)}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  {useRecovery ? "Use authenticator code instead" : "Use a recovery code instead"}
                </button>
              </>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              {t("auth.signIn")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">{icon}{label}</span>
      {children}
    </label>
  );
}
