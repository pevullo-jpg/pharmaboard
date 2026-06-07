import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/pharmacy/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, FileText, AlertTriangle, Euro, ArrowRight, Mail, Loader2, ExternalLink, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { syncGmailRicette, getRicettaAttachment, deleteRicettaEmail } from "@/lib/gmail.functions";
import { toast } from "sonner";
import { DebitiBadge } from "@/components/pharmacy/debiti-badge";
import { AnticipiBadge } from "@/components/pharmacy/anticipi-badge";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard · Farmacia" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const sync = useServerFn(syncGmailRicette);
  const openAtt = useServerFn(getRicettaAttachment);
  const delEmail = useServerFn(deleteRicettaEmail);
  const syncMutation = useMutation({
    mutationFn: async () => sync(),
    onSuccess: (r) => {
      toast.success(`Sync completata: ${r.importedRicette} nuove ricette su ${r.checked} email`);
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openMutation = useMutation({
    mutationFn: async (ricettaId: string) => openAtt({ data: { ricettaId } }),
    onSuccess: (res) => {
      const w = window.open("", "_blank");
      if (!w) {
        toast.error("Popup bloccato. Consenti i popup per aprire la ricetta.");
        return;
      }
      if (res.mimeType === "application/pdf") {
        w.document.write(`<iframe src="${res.dataUrl}" style="border:0;width:100%;height:100vh"></iframe>`);
      } else {
        w.document.write(`<img src="${res.dataUrl}" style="max-width:100%;height:auto" alt="${res.filename}" />`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ricettaId: string) => delEmail({ data: { ricettaId } }),
    onSuccess: () => {
      toast.success("Email spostata nel cestino e ricetta eliminata");
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [prenotazioni, ricette, dpc, debiti, ultimeRicette] = await Promise.all([
        supabase.from("prenotazioni").select("id", { count: "exact", head: true }).in("stato", ["in_attesa", "pronto"]),
        supabase.from("ricette").select("id", { count: "exact", head: true }).eq("stato", "nuova"),
        supabase.from("ricette").select("id", { count: "exact", head: true }).eq("is_dpc_alert", true).eq("stato", "nuova"),
        supabase.from("debiti").select("importo").eq("stato", "aperto"),
        supabase.from("ricette").select("id, assistito_id, nome, cognome, codice_fiscale, data_ricetta, medico, dpc, is_dpc_alert, stato, created_at").order("created_at", { ascending: false }).limit(8),
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
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="gap-2"
        >
          {syncMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Sincronizza Gmail
        </Button>
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
              <div className="flex items-center gap-2 shrink-0">
                {r.assistito_id && (
                  <DebitiBadge assistitoId={r.assistito_id} label={`${r.cognome ?? ""} ${r.nome ?? ""}`.trim()} />
                )}
                {r.assistito_id && (
                  <AnticipiBadge assistitoId={r.assistito_id} label={`${r.cognome ?? ""} ${r.nome ?? ""}`.trim()} />
                )}
                <Badge variant={r.stato === "nuova" ? "default" : "secondary"}>{r.stato}</Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Apri ricetta"
                  disabled={openMutation.isPending && openMutation.variables === r.id}
                  onClick={() => openMutation.mutate(r.id)}
                >
                  {openMutation.isPending && openMutation.variables === r.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <ExternalLink className="size-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Elimina email e ricetta"
                  disabled={deleteMutation.isPending && deleteMutation.variables === r.id}
                  onClick={() => {
                    if (window.confirm("Spostare l'email nel cestino di Gmail ed eliminare la ricetta?")) {
                      deleteMutation.mutate(r.id);
                    }
                  }}
                >
                  {deleteMutation.isPending && deleteMutation.variables === r.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Trash2 className="size-4 text-destructive" />}
                </Button>
              </div>
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