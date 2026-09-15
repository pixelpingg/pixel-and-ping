import { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", icon, loading, children, className = "", disabled, ...rest }: Props) {
  const base = "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm";
  const variants: Record<string, string> = {
    primary: "bg-ping-gradient text-white shadow-glow hover:brightness-110 active:scale-[0.98]",
    secondary: "bg-base-700 text-slate-200 hover:bg-base-600 border border-white/5",
    danger: "bg-signal-rose/10 text-signal-rose border border-signal-rose/30 hover:bg-signal-rose/20",
    ghost: "text-slate-300 hover:bg-white/5",
  };

  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : icon}
      {children}
    </button>
  );
}
