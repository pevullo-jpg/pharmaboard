import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type StatTone = "primary" | "accent" | "secondary" | "emerald";

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
  label, value, icon: Icon, accent = false, hint, tone, active, onClick,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: boolean;
  hint?: string;
  tone?: StatTone;
  active?: boolean;
  onClick?: () => void;
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
        active && TONE_ACTIVE[t],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={cn("size-10 rounded-xl grid place-items-center shrink-0", active ? TONE_ICON_ACTIVE[t] : TONE_ICON[t])}>
          <Icon className="size-5" />
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-12 -right-12 size-32 rounded-full bg-gradient-to-br from-accent/10 to-transparent blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
    </Card>
  );
}