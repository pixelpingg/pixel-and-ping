import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/store/ToastContext";
import { ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";

interface Status { enabled: boolean; remainingRecoveryCodes: number; }

export function TwoFactorPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "recovery">("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const res = await api.get("/auth/2fa/status");
      setStatus(res.data);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => { load(); }, []);

  async function startSetup() {
    setBusy(true);
    try {
      const res = await api.post("/auth/2fa/setup");
      setQrDataUrl(res.data.qrDataUrl);
      setSecret(res.data.secret);
      setStep("verify");
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const res = await api.post("/auth/2fa/verify", { totpCode: code });
      setRecoveryCodes(res.data.recoveryCodes);
      setStep("recovery");
      toast("success", "2FA enabled");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err, "Invalid code"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await api.post("/auth/2fa/disable", { password });
      toast("success", "2FA disabled");
      setStep("idle");
      setPassword("");
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err, "Incorrect password"));
    } finally {
      setBusy(false);
    }
  }

  function copyCodes() {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!status) return null;

  if (status.enabled && step === "idle") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-signal-teal">
          <ShieldCheck size={16} /> Two-factor authentication is enabled
          <span className="text-slate-500">({status.remainingRecoveryCodes} recovery codes left)</span>
        </div>
        <label className="block max-w-xs">
          <span className="text-xs font-medium text-slate-400 mb-1.5 block">Confirm password to disable</span>
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Button variant="danger" size="sm" icon={<ShieldOff size={14} />} loading={busy} onClick={disable} disabled={!password}>
          Disable 2FA
        </Button>
      </div>
    );
  }

  if (step === "recovery") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-300">Save these recovery codes somewhere safe. Each can be used once if you lose access to your authenticator. They will not be shown again.</p>
        <div className="glass rounded-xl p-4 grid grid-cols-2 gap-2 font-mono text-sm text-slate-200">
          {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
        </div>
        <Button size="sm" variant="secondary" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copyCodes}>
          {copied ? "Copied" : "Copy all"}
        </Button>
        <Button size="sm" className="ms-2" onClick={() => setStep("idle")}>Done</Button>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-400">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
        {qrDataUrl && <img src={qrDataUrl} alt="2FA QR code" className="rounded-xl bg-white p-2 w-40 h-40" />}
        {secret && <p className="text-xs text-slate-500 font-mono">Manual entry key: {secret}</p>}
        <div className="flex gap-2 items-end max-w-xs">
          <label className="block flex-1">
            <span className="text-xs font-medium text-slate-400 mb-1.5 block">6-digit code</span>
            <input className="input font-mono tracking-widest text-center" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <Button loading={busy} onClick={verify} disabled={code.length !== 6}>Verify</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <ShieldOff size={16} /> Two-factor authentication is off
      </div>
      <Button size="sm" loading={busy} onClick={startSetup}>Enable 2FA</Button>
    </div>
  );
}
