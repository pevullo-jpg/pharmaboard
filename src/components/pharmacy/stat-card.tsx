import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type StatTone = "primary" | "accent" | "secondary" | "emerald";
export type NeonColor = "yellow" | "fuchsia" | "red" | "green";

const NEON_ACTIVE: Record<NeonColor, string> = {
  yellow:
    "border-2 border-yellow-300 bg-yellow-400/15 ring-2 ring-yellow-300/60 shadow-[0_0_24px_4px_rgba(250,204,21,0.75),inset_0_0_18px_rgba(250,204,21,0.45)]",
  fuchsia:
    "border-2 border-fuchsia-400 bg-fuchsia-500/15 ring-2 ring-fuchsia-400/60 shadow-[0_0_24px_4px_rgba(232,121,249,0.8),inset_0_0_18px_rgba(232,121,249,0.45)]",
  red:
    "border-2 border-red-500 bg-red-500/15 ring-2 ring-red-500/60 shadow-[0_0_24px_4px_rgba(239,68,68,0.85),inset_0_0_18px_rgba(239,68,68,0.45)]",
  green:
    "border-2 border-emerald-400 bg-emerald-500/15 ring-2 ring-emerald-400/60 shadow-[0_0_24px_4px_rgba(16,185,129,0.85),inset_0_0_18px_rgba(16,185,129,0.45)]",
};

const NEON_TEXT: Record<NeonColor, string> = {
  yellow: "text-yellow-300 [text-shadow:0_0_10px_rgba(250,204,21,0.9)]",
  fuchsia: "text-fuchsia-300 [text-shadow:0_0_10px_rgba(232,121,249,0.9)]",
  red: "text-red-400 [text-shadow:0_0_10px_rgba(239,68,68,0.9)]",
  green: "text-emerald-300 [text-shadow:0_0_10px_rgba(16,185,129,0.9)]",
};

const NEON_ICON_ACTIVE: Record<NeonColor, string> = {
  yellow: "bg-yellow-400/25 text-yellow-300 shadow-[0_0_12px_rgba(250,204,21,0.7)]",
  fuchsia: "bg-fuchsia-500/25 text-fuchsia-300 shadow-[0_0_12px_rgba(232,121,249,0.7)]",
  red: "bg-red-500/25 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.7)]",
  green: "bg-emerald-500/25 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.7)]",
};

const TONE_ACTIVE: Record<StatTone, string> = {
  primary: "neon-flash neon-primary border-2 border-primary/80 bg-primary/20 ring-2 ring-primary/40 shadow-[0_0_40px_-4px_var(--primary)]",
  accent: "neon-flash neon-accent border-2 border-accent/80 bg-accent/20 ring-2 ring-accent/40 shadow-[0_0_40px_-4px_var(--accent)]",
  secondary: "neon-flash neon-primary border-2 border-primary/70 bg-secondary/60 ring-2 ring-primary/40 shadow-[0_0_40px_-4px_var(--primary)]",
  emerald: "neon-flash neon-emerald border-2 border-emerald-400/80 bg-emerald-500/20 ring-2 ring-emerald-400/40 shadow-[0_0_40px_-4px_rgb(16_185_129/0.85)]",
};

const TONE_TEXT: Record<StatTone, string> = {
  primary: "text-primary",
  accent: "text-accent",
  secondary: "text-primary",
  emerald: "text-emerald-400",
};

const TONE_ICON: Record<StatTone, string> = {
  primary: "bg-primary/15 text-primary",
  accent: "bg-accent/15 text-accent",
  secondary: "bg-secondary/50 text-secondary-foreground",
  emerald: "bg-emerald-500/15 text-emerald-400",
};

const TONE_ICON_ACTIVE: Record<StatTone, string> = {
  primary: "bg-primary/25 text-primary",
  accent: "bg-accent/25 text-accent",
  secondary: "bg-secondary text-secondary-foreground",
  emerald: "bg-emerald-500/25 text-emerald-300",
};

export function StatCard({
  label, value, icon: Icon, accent = false, hint, tone, active, onClick, neonColor, dangerIcon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: boolean;
  hint?: string;
  tone?: StatTone;
  active?: boolean;
  onClick?: () => void;
  neonColor?: NeonColor;
  dangerIcon?: boolean;
}) {
  const isClickable = typeof onClick === "function";
  const t: StatTone = tone ?? (accent ? "accent" : "primary");
  return (
    <Card
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      className={cn(
        "glass-card p-5 relative overflow-hidden group transition-all",
        isClickable && "cursor-pointer hover:-translate-y-0.5",
        !isClickable && "hover:-translate-y-0.5",
        !active && accent && "border-accent/40 accent-glow",
        active && (neonColor ? NEON_ACTIVE[neonColor] : TONE_ACTIVE[t]),
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={cn(
            "mt-2 text-3xl font-semibold tabular-nums tracking-tight",
            active && (neonColor ? NEON_TEXT[neonColor] : "text-white"),
          )}>{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={cn(
          "size-10 rounded-xl grid place-items-center shrink-0",
          active
            ? (neonColor ? NEON_ICON_ACTIVE[neonColor] : TONE_ICON_ACTIVE[t])
            : TONE_ICON[t],
          dangerIcon && "bg-red-500/25 text-red-400 ring-2 ring-red-500/70 shadow-[0_0_16px_4px_rgba(239,68,68,0.85)]",
        )}>
          <Icon className="size-5" />
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-12 -right-12 size-32 rounded-full bg-gradient-to-br from-accent/10 to-transparent blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
    </Card>
  );
}