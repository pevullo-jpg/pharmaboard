import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/pharmacy/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, FileText, AlertTriangle, Euro, ArrowRight, Mail } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard · Farmacia" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [prenotazioni, ricette, dpc, debiti, ultimeRicette] = await Promise.all([
        supabase.from("prenotazioni").select("id", { count: "exact", head: true }).in("stato", ["in_attesa", "pronto"]),
        supabase.from("ricette").select("id", { count: "exact", head: true }).eq("stato", "nuova"),
        supabase.from("ricette").select("id", { count: "exact", head: true }).eq("is_dpc_alert", true).eq("stato", "nuova"),
        supabase.from("debiti").select("importo").eq("stato", "aperto"),
        supabase.from("ricette").select("id, nome, cognome, codice_fiscale, data_ricetta, medico, dpc, is_dpc_alert, stato, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      const totaleDebiti = (debiti.data ?? []).reduce((s, r: { importo: number | string }) => s + Number(r.importo ?? 0), 0);
      return {
        prenotazioni: prenotazioni.count ?? 0,
        ricette: ricette.count ?? 0,
        dpc: dpc.count ?? 0,
        debiti: totaleDebiti,
        ultime: ultimeRicette.data ?? [],
      };
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Panoramica giornaliera della farmacia</p>
        </div>
        <Link to="/impostazioni">
          <Button variant="outline" className="gap-2">
            <Mail className="size-4" /> Sincronizza Gmail
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Prenotazioni attive" value={isLoading ? "…" : data!.prenotazioni} icon={CalendarClock} hint="In attesa o pronte" />
        <StatCard label="Ricette nuove" value={isLoading ? "…" : data!.ricette} icon={FileText} hint="Da lavorare" />
        <StatCard label="Avvisi DPC" value={isLoading ? "…" : data!.dpc} icon={AlertTriangle} accent hint="Da evidenziare" />
        <StatCard
          label="Debiti aperti"
          value={isLoading ? "…" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(data!.debiti)}
          icon={Euro}
          hint="Totale insoluto"
        />
      </div>

      <Card className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Ultime ricette</h2>
            <p className="text-xs text-muted-foreground">Importate da Gmail o inserite manualmente</p>
          </div>
        </div>
        <div className="divide-y divide-border/40">
          {(data?.ultime ?? []).length === 0 && !isLoading && (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              Nessuna ricetta ancora. Collega Gmail in Impostazioni o aggiungi manualmente.
            </div>
          )}
          {(data?.ultime ?? []).map((r) => (
            <div key={r.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-sidebar-accent/30 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{r.cognome ?? ""} {r.nome ?? ""}</span>
                  {r.codice_fiscale && <span className="text-xs text-muted-foreground font-mono">{r.codice_fiscale}</span>}
                  {r.is_dpc_alert && <Badge className="bg-accent/20 text-accent border border-accent/40 accent-glow">DPC</Badge>}
                  {r.dpc && !r.is_dpc_alert && <Badge variant="outline">DPC</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                  {r.medico && <span>Dr. {r.medico}</span>}
                  {r.data_ricetta && <span>{format(new Date(r.data_ricetta), "d MMM yyyy", { locale: it })}</span>}
                </div>
              </div>
              <Badge variant={r.stato === "nuova" ? "default" : "secondary"}>{r.stato}</Badge>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border/60">
          <Link to="/assistiti" className="text-xs text-accent inline-flex items-center gap-1 hover:underline">
            Vai agli assistiti <ArrowRight className="size-3" />
          </Link>
        </div>
      </Card>
    </div>
  );
}