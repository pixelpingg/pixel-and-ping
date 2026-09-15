import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/store/ToastContext";
import { Plus, Copy, Check, Ban, Trash2 } from "lucide-react";

interface ApiKey {
  id: string; name: string; keyPrefix: string; scopes: string[]; isActive: boolean;
  lastUsedAt: string | null; createdAt: string; revokedAt: string | null;
}

const SCOPES = ["TRAFFIC_INGEST", "PRESENCE_INGEST", "FULL_INGEST"];

export function ApiKeysPanel() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["FULL_INGEST"]);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const res = await api.get("/api-keys");
      setKeys(res.data.keys);
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setSaving(true);
    try {
      const res = await api.post("/api-keys", { name, scopes });
      setNewKey(res.data.plaintextKey);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.post(`/api-keys/${id}/revoke`);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/api-keys/${id}`);
      load();
    } catch (err) {
      toast("error", getApiErrorMessage(err));
    }
  }

  function copyKey() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function closeModal() {
    setModalOpen(false);
    setNewKey(null);
    setName("");
    setScopes(["FULL_INGEST"]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 max-w-md">
          Long-lived credentials for an authorized VPN daemon or metering service to push real
          traffic and presence data via <code className="font-mono">/api/ingest/*</code>.
        </p>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setModalOpen(true)}>New key</Button>
      </div>

      {keys.length === 0 ? (
        <EmptyState description="No ingestion API keys yet." />
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between bg-white/[0.02] rounded-xl px-3 py-2.5">
              <div>
                <div className="text-sm text-slate-200 font-medium">{k.name}</div>
                <div className="text-xs text-slate-500 font-mono">{k.keyPrefix}… · {k.scopes.join(", ")}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={k.isActive ? "ACTIVE" : "DISABLED"} />
                {k.isActive && (
                  <button onClick={() => revoke(k.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-signal-amber hover:bg-white/5" title="Revoke">
                    <Ban size={14} />
                  </button>
                )}
                <button onClick={() => remove(k.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-signal-rose hover:bg-signal-rose/10" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title="New ingestion API key">
        {newKey ? (
          <div className="space-y-4">
            <p className="text-sm text-signal-teal">Key created. Copy it now — it will not be shown again.</p>
            <div className="glass rounded-xl p-3 flex items-center justify-between gap-2">
              <code className="text-xs text-slate-200 font-mono break-all">{newKey}</code>
              <button onClick={copyKey} className="text-slate-400 hover:text-slate-100 shrink-0">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <Button className="w-full" onClick={closeModal}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-400 mb-1.5 block">Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="production-vpn-daemon" />
            </label>
            <div>
              <span className="text-xs font-medium text-slate-400 mb-1.5 block">Scopes</span>
              <div className="space-y-1.5">
                {SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={(e) =>
                        setScopes((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <Button className="w-full" loading={saving} disabled={!name || scopes.length === 0} onClick={create}>
              Create key
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
