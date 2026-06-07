import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, Settings, LogOut, Pill, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyFarmacia } from "@/lib/farmacie.functions";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/assistiti", label: "Assistiti", icon: Users },
  { to: "/impostazioni", label: "Anticipi", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchFarm = useServerFn(getMyFarmacia);
  const { data: ctx } = useQuery({
    queryKey: ["my-farmacia"],
    queryFn: () => fetchFarm(),
    staleTime: 30_000,
  });
  const farmaciaName = ctx?.farmacia?.nome ?? "Farmacia";
  const isSuperAdmin = ctx?.isSuperAdmin ?? false;

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex w-64 flex-col border-r border-border/60 bg-sidebar/80 backdrop-blur-xl">
        <div className="px-6 py-6 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center accent-glow">
            <Pill className="size-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold tracking-tight truncate" title={farmaciaName}>{farmaciaName}</div>
            <div className="text-xs text-muted-foreground">Dashboard</div>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {nav.map((item) => {
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as "/"}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                  active
                    ? "bg-accent/15 text-accent border border-accent/30 accent-glow"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
          {isSuperAdmin && (
            <div className="mt-4 border-t border-border/40 pt-4 space-y-1">
              <Link
                to="/admin/farmacie"
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                  location.pathname === "/admin/farmacie"
                    ? "bg-accent/15 text-accent border border-accent/30 accent-glow"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <ShieldCheck className="size-4" />
                Admin Farmacie
              </Link>
              <Link
                to="/admin/email-pending"
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                  location.pathname === "/admin/email-pending"
                    ? "bg-accent/15 text-accent border border-accent/30 accent-glow"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <ShieldCheck className="size-4" />
                Email da assegnare
              </Link>
            </div>
          )}
        </nav>
        <div className="p-3 border-t border-border/60">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={handleSignOut}>
            <LogOut className="size-4" /> Esci
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border/60 bg-sidebar/80 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center">
              <Pill className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Farmacia</span>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSignOut}>
            <LogOut className="size-4" />
          </Button>
        </header>
        <nav className="md:hidden flex gap-1 px-3 py-2 border-b border-border/60 bg-sidebar/40 overflow-x-auto">
          {nav.map((item) => {
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to as "/"}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs whitespace-nowrap",
                  active ? "bg-accent/15 text-accent border border-accent/30" : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 md:p-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}