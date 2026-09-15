import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/store/ToastContext";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, ArrowLeft, Check, ShieldCheck, ShieldQuestion, AlertTriangle } from "lucide-react";

interface Server { id: string; name: string; }
interface Endpoint { id: string; label: string; serverId: string; }
interface CfAccount { id: string; name: string; }
interface CfZone { id: string; name: string; status: string; }
interface PortRow { id: string; number: number; type: string; label: string | null; }
interface CreatedConfig {
  rawConfig: string;
  hostname: string | null;
  cloudflareVerified: boolean;
}
interface Provisioning { status: string; message: string }

export default function CreateUser() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [servers, setServers] = useState<Server[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [cfAccounts, setCfAccounts] = useState<CfAccount[]>([]);
  const [cfZones, setCfZones] = useState<CfZone[]>([]);
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [selectedPorts, setSelectedPorts] = useState<number[]>([]);

  const [form, setForm] = useState({
    username: "",
    serverId: "",
    endpointId: "",
    protocol: "vless",
    port: 443,
    tls: true,
    // Days from today; 0 (the default) means "never expires" — matches
    // the traffic/request limit fields' own 0-means-unlimited convention
    // instead of a blank-vs-filled date picker, which is easy to
    // misread as "not sure yet" rather than "deliberately unlimited".
    expiryDays: "0",
    trafficLimitGb: "",
    requestLimit: "",
    autoIpFailover: false,
    cloudflareAccountId: "",
    cloudflareZoneId: "",
    hostname: "",
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreatedConfig | null>(null);
  const [provisioning, setProvisioning] = useState<Provisioning | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get("/servers").then((res) => {
      const list: Server[] = res.data.servers;
      setServers(list);
      // The Worker auto-provisions its own domain as a server the moment
      // it's deployed (see worker/src/services/selfServerService.ts) —
      // no "Add Server" step needed. Pre-select it (or whichever single
      // server exists) so an admin never has to manually pick one just
      // to create a user.
      setForm((f) => (f.serverId ? f : { ...f, serverId: list.find((s) => s.id === "self-worker")?.id ?? (list.length === 1 ? list[0].id : "") }));
    }).catch(() => undefined);
    api.get("/cloudflare/accounts").then((res) => setCfAccounts(res.data.accounts)).catch(() => undefined);
    api.get("/ports").then((res) => setPorts(res.data.ports)).catch(() => undefined);
  }, []);

  // Endpoints are scoped to the selected server — never a flat, unrelated list.
  useEffect(() => {
    setForm((f) => ({ ...f, endpointId: "" }));
    if (!form.serverId) {
      setEndpoints([]);
      return;
    }
    api.get("/endpoints", { params: { serverId: form.serverId } }).then((res) => setEndpoints(res.data.endpoints)).catch(() => undefined);
  }, [form.serverId]);

  // Zones are scoped to the selected Cloudflare account.
  useEffect(() => {
    setForm((f) => ({ ...f, cloudflareZoneId: "", hostname: "" }));
    if (!form.cloudflareAccountId) {
      setCfZones([]);
      return;
    }
    api.get(`/cloudflare/accounts/${form.cloudflareAccountId}/zones`).then((res) => setCfZones(res.data.zones)).catch(() => undefined);
  }, [form.cloudflareAccountId]);

  function togglePort(n: number) {
    setSelectedPorts((prev) => (prev.includes(n) ? prev.filter((p) => p !== n) : [...prev, n]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // At least one port is required — either one checked from the
    // operator's registered Ports list, or the manual fallback field
    // when nothing has been registered there yet.
    const chosenPorts = selectedPorts.length > 0 ? selectedPorts : [Number(form.port)];
    const days = Number(form.expiryDays) || 0;
    setLoading(true);
    try {
      const res = await api.post("/users", {
        username: form.username,
        serverId: form.serverId,
        preferredEndpointId: form.endpointId || undefined,
        protocol: form.protocol,
        port: chosenPorts[0],
        extraPorts: chosenPorts.slice(1),
        tls: form.tls,
        expiresAt: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : undefined,
        trafficLimitGb: form.trafficLimitGb ? Number(form.trafficLimitGb) : undefined,
        requestLimit: form.requestLimit ? Number(form.requestLimit) : undefined,
        autoIpFailover: form.autoIpFailover,
        cloudflareAccountId: form.cloudflareAccountId || undefined,
        cloudflareZoneId: form.cloudflareZoneId || undefined,
        hostname: form.hostname || undefined,
      });
      setResult(res.data.configuration);
      setProvisioning(res.data.provisioning ?? null);
      toast("success", t("users.created"));
    } catch (err) {
      // Includes the case where Cloudflare zone/DNS verification failed —
      // the backend refuses to generate a config against a resource it
      // could not confirm actually exists, and the user record is rolled
      // back rather than left half-created.
      toast("error", getApiErrorMessage(err, t("users.createFailed")));
    } finally {
      setLoading(false);
    }
  }

  function copyConfig() {
    if (!result) return;
    navigator.clipboard.writeText(result.rawConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadConfig() {
    if (!result) return;
    const blob = new Blob([result.rawConfig], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.username}-config.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (result) {
    return (
      <div className="max-w-lg mx-auto space-y-5">
        <button onClick={() => navigate("/users")} className="text-sm text-slate-400 flex items-center gap-1.5 hover:text-slate-200">
          <ArrowLeft size={15} /> {t("common.back")}
        </button>
        <div className="glass rounded-2xl p-6 text-center space-y-5">
          <h2 className="font-display text-lg font-semibold text-slate-50">{t("users.created")}</h2>

          {provisioning && (
            <div className="text-start glass rounded-xl p-3 flex gap-2.5 items-start">
              <AlertTriangle size={16} className="text-signal-amber mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-medium text-slate-200">
                  VPN server provisioning: {provisioning.status.replace("_", " ")}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{provisioning.message}</p>
              </div>
            </div>
          )}

          {result.hostname && (
            <div className="text-start flex items-center gap-1.5 text-xs">
              {result.cloudflareVerified ? (
                <ShieldCheck size={14} className="text-signal-teal shrink-0" />
              ) : (
                <ShieldQuestion size={14} className="text-signal-amber shrink-0" />
              )}
              <span className="text-slate-400 font-mono">{result.hostname}</span>
              <span className="text-slate-500">
                {result.cloudflareVerified ? "— DNS record verified against Cloudflare" : "— not Cloudflare-verified"}
              </span>
            </div>
          )}

          <div className="bg-white p-4 rounded-xl inline-block">
            <QRCodeSVG value={result.rawConfig} size={180} />
          </div>
          <div className="glass rounded-xl p-3 text-start">
            <code className="text-xs text-slate-300 break-all font-mono">{result.rawConfig}</code>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="secondary" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={copyConfig}>
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
            <Button variant="secondary" icon={<Download size={15} />} onClick={downloadConfig}>{t("common.download")}</Button>
          </div>
          <Button className="w-full" onClick={() => navigate("/users")}>{t("common.close")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <button onClick={() => navigate("/users")} className="text-sm text-slate-400 flex items-center gap-1.5 hover:text-slate-200">
        <ArrowLeft size={15} /> {t("common.back")}
      </button>
      <h1 className="font-display text-2xl font-semibold text-slate-50">{t("users.createUser")}</h1>

      <form onSubmit={handleSubmit} className="glass rounded-2xl p-6 space-y-4">
        <Field label={t("users.username")}>
          <input required className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t("users.server")}>
            <select required className="input" value={form.serverId} onChange={(e) => setForm({ ...form, serverId: e.target.value })}>
              <option value="">—</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={t("nav.endpoints")}>
            <select className="input" disabled={!form.serverId} value={form.endpointId} onChange={(e) => setForm({ ...form, endpointId: e.target.value })}>
              <option value="">Default / any</option>
              {endpoints.map((ep) => <option key={ep.id} value={ep.id}>{ep.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t("servers.protocol")}>
            <select className="input" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
              <option value="vless">VLESS</option>
              <option value="trojan">Trojan</option>
            </select>
          </Field>
          {ports.length === 0 ? (
            <Field label={t("servers.port")}>
              <input type="number" required className="input" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
            </Field>
          ) : (
            <div />
          )}
        </div>

        {ports.length > 0 && (
          <Field label={`${t("servers.port")} (${t("common.selectMultiple", "select one or more")})`}>
            <div className="flex flex-wrap gap-2">
              {ports.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => togglePort(p.number)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                    selectedPorts.includes(p.number)
                      ? "bg-brand-500/20 border-brand-500/50 text-brand-200"
                      : "border-white/10 text-slate-400 hover:border-white/20"
                  }`}
                >
                  {p.number} <span className="opacity-60">· {p.type === "TLS" ? "TLS" : "non-TLS"}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Every port you select gets its own ready-to-use config/link for this user — register more under Ports.
            </p>
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.tls} onChange={(e) => setForm({ ...form, tls: e.target.checked })} />
          TLS
        </label>

        <div className="grid grid-cols-2 gap-4">
          <Field label={`${t("users.expiration")} (${t("common.days", "days")})`}>
            <input
              type="number"
              min={0}
              className="input"
              value={form.expiryDays}
              onChange={(e) => setForm({ ...form, expiryDays: e.target.value })}
            />
            <p className="text-[11px] text-slate-500 mt-1">0 = {t("common.unlimited", "never expires")}</p>
          </Field>
          <Field label={`${t("users.trafficLimit")} (GB)`}>
            <input type="number" min={0} className="input" value={form.trafficLimitGb} onChange={(e) => setForm({ ...form, trafficLimitGb: e.target.value })} />
            <p className="text-[11px] text-slate-500 mt-1">0 {t("common.orBlank", "or blank")} = {t("common.unlimited", "unlimited")}</p>
          </Field>
        </div>

        <Field label={t("users.requests")}>
          <input type="number" min={0} className="input" value={form.requestLimit} onChange={(e) => setForm({ ...form, requestLimit: e.target.value })} />
          <p className="text-[11px] text-slate-500 mt-1">0 {t("common.orBlank", "or blank")} = {t("common.unlimited", "unlimited")}</p>
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.autoIpFailover} onChange={(e) => setForm({ ...form, autoIpFailover: e.target.checked })} />
          Auto IP Failover
        </label>

        <div className="border-t border-white/5 pt-4 space-y-3">
          <p className="text-xs text-slate-500">
            Optional — tie this user's configuration to a real, verified Cloudflare zone/hostname.
            Creation is refused if the zone or DNS record doesn't actually exist in Cloudflare.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("cloudflare.title")}>
              <select className="input" value={form.cloudflareAccountId} onChange={(e) => setForm({ ...form, cloudflareAccountId: e.target.value })}>
                <option value="">None</option>
                {cfAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label={t("cloudflare.zones")}>
              <select className="input" disabled={!form.cloudflareAccountId} value={form.cloudflareZoneId} onChange={(e) => setForm({ ...form, cloudflareZoneId: e.target.value })}>
                <option value="">—</option>
                {cfZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </Field>
            <Field label="Hostname">
              <input className="input" disabled={!form.cloudflareZoneId} placeholder="vpn.example.com" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
            </Field>
          </div>
        </div>

        <Button type="submit" className="w-full" loading={loading}>{t("common.create")}</Button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400 mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
