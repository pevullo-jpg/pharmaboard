import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  label, value, icon: Icon, accent = false, hint,
}: { label: string; value: string | number; icon: LucideIcon; accent?: boolean; hint?: string }) {
  return (
    <Card className={cn("glass-card p-5 relative overflow-hidden group transition-all hover:-translate-y-0.5", accent && "border-accent/40 accent-glow")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={cn("size-10 rounded-xl grid place-items-center shrink-0", accent ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary")}>
          <Icon className="size-5" />
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-12 -right-12 size-32 rounded-full bg-gradient-to-br from-accent/10 to-transparent blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
    </Card>
  );
}