import { useMemo, useRef } from "react";
import { Upload, Check } from "lucide-react";

function avatarSvg(kind: "male" | "female", bg: string, hair: string) {
  const accent = kind === "female" ? "#D323EA" : "#339BFB";
  const hairShape = kind === "female"
    ? `<path d="M37 39c0-15 10-25 27-25s27 10 27 25v26H37z" fill="${hair}"/><path d="M43 43c2-12 10-19 21-19 12 0 20 7 22 19v17H43z" fill="#F2C6A0"/>`
    : `<path d="M39 40c2-16 11-24 25-24s23 8 25 24H39z" fill="${hair}"/><path d="M45 42c2-10 9-17 19-17s17 7 19 17v19H45z" fill="#F2C6A0"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#0b1020"/></linearGradient></defs><rect width="128" height="128" rx="32" fill="url(#g)"/><circle cx="64" cy="64" r="44" fill="${accent}" opacity=".13"/>${hairShape}<circle cx="56" cy="49" r="3" fill="#111827"/><circle cx="72" cy="49" r="3" fill="#111827"/><path d="M56 60c5 4 11 4 16 0" fill="none" stroke="#7c4a3b" stroke-width="3" stroke-linecap="round"/><path d="M43 105c3-18 12-28 21-28s18 10 21 28" fill="#111827"/><path d="M47 105c3-12 10-18 17-18s14 6 17 18" fill="${accent}" opacity=".9"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const AVATAR_PRESETS = [
  { id: "m1", label: "Nova", src: avatarSvg("male", "#2023A5", "#111827") },
  { id: "m2", label: "Atlas", src: avatarSvg("male", "#305DE3", "#3b241b") },
  { id: "m3", label: "Orion", src: avatarSvg("male", "#620A9A", "#1f2937") },
  { id: "f1", label: "Luna", src: avatarSvg("female", "#9003AC", "#2a1712") },
  { id: "f2", label: "Mira", src: avatarSvg("female", "#D323EA", "#4b1d2a") },
  { id: "f3", label: "Vega", src: avatarSvg("female", "#339BFB", "#111827") },
];

export function Avatar({ src, size = 44, fallback = "P" }: { src?: string | null; size?: number; fallback?: string }) {
  return src ? <img src={src} alt="Profile avatar" style={{ width: size, height: size }} className="rounded-full object-cover ring-1 ring-white/10" /> : <div style={{ width: size, height: size }} className="rounded-full bg-brand-gradient flex items-center justify-center font-semibold text-white ring-1 ring-white/10">{fallback}</div>;
}

export function AvatarPicker({ value, onChange }: { value?: string | null; onChange: (src: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const current = useMemo(() => value, [value]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {AVATAR_PRESETS.map((avatar) => (
          <button key={avatar.id} type="button" onClick={() => onChange(avatar.src)} className={`relative rounded-full p-0.5 transition-transform hover:scale-105 ${current === avatar.src ? "ring-2 ring-brand-cyan" : "ring-1 ring-white/10"}`} title={avatar.label}>
            <Avatar src={avatar.src} size={56} />
            {current === avatar.src && <span className="absolute -bottom-0.5 -end-0.5 h-5 w-5 rounded-full bg-brand-gradient flex items-center justify-center"><Check size={12} /></span>}
          </button>
        ))}
        <button type="button" onClick={() => inputRef.current?.click()} className="h-14 w-14 rounded-full border border-dashed border-white/15 text-slate-400 hover:text-white hover:border-brand-cyan/50 flex items-center justify-center transition-colors" title="Upload your own avatar"><Upload size={18} /></button>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 200 * 1024) { window.alert("Please choose an image smaller than 200 KB."); e.target.value = ""; return; }
        const reader = new FileReader();
        reader.onload = () => onChange(typeof reader.result === "string" ? reader.result : null);
        reader.readAsDataURL(file);
      }} />
    </div>
  );
}
