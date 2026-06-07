import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAllFarmacie, setFarmaciaStato } from "@/lib/farmacie.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, CheckCircle2, PauseCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/farmacie")({
  head: () => ({ meta: [{ title: "Farmacie · Admin" }] }),
  component: AdminFarmaciePage,
});

function AdminFarmaciePage() {
  const list = useServerFn(listAllFarmacie);
  const setStato = useServerFn(setFarmaciaStato);
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-farmacie"],
    queryFn: () => list(),
  });

  const change = async (id: string, stato: "attiva" | "sospesa" | "disattivata") => {
    setBusyId(id);
    try {
      await setStato({ data: { farmaciaId: id, stato } });
      toast.success(`Stato aggiornato: ${stato}`);
      await qc.invalidateQueries({ queryKey: ["admin-farmacie"] });
      await qc.invalidateQueries({ queryKey: ["my-farmacia"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (isError) return <p className="text-destructive">{error instanceof Error ? error.message : "Errore"}</p>;

  const farmacie = data?.farmacie ?? [];
  const counts = data?.counts ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center">
          <ShieldCheck className="size-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gestione Farmacie</h1>
          <p className="text-sm text-muted-foreground">{farmacie.length} farmacie registrate</p>
        </div>
      </div>

      <div className="grid gap-3">
        {farmacie.map((f) => {
          const c = counts[f.id] ?? { members: 0, ricette: 0, assistiti: 0 };
          return (
            <Card key={f.id} className="glass-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{f.nome}</h3>
                    <StatoBadge stato={f.stato} />
                  </div>
                  <div className="text-xs text-muted-foreground space-x-3">
                    {f.ragione_sociale && <span>{f.ragione_sociale}</span>}
                    {f.partita_iva && <span>P.IVA {f.partita_iva}</span>}
                    {f.citta && <span>{f.citta}{f.cap ? ` (${f.cap})` : ""}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground space-x-3">
                    {f.email_contatto && <span>✉ {f.email_contatto}</span>}
                    {f.telefono && <span>☎ {f.telefono}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground pt-1">
                    {c.members} operatori · {c.assistiti} assistiti · {c.ricette} ricette
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {f.stato !== "attiva" && (
                    <Button size="sm" disabled={busyId === f.id} onClick={() => change(f.id, "attiva")}>
                      <CheckCircle2 className="size-4 mr-1" />Attiva
                    </Button>
                  )}
                  {f.stato !== "sospesa" && (
                    <Button size="sm" variant="outline" disabled={busyId === f.id} onClick={() => change(f.id, "sospesa")}>
                      <PauseCircle className="size-4 mr-1" />Sospendi
                    </Button>
                  )}
                  {f.stato !== "disattivata" && (
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busyId === f.id} onClick={() => change(f.id, "disattivata")}>
                      <XCircle className="size-4 mr-1" />Disattiva
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        {farmacie.length === 0 && (
          <Card className="glass-card p-8 text-center text-muted-foreground">Nessuna farmacia registrata.</Card>
        )}
      </div>
    </div>
  );
}

function StatoBadge({ stato }: { stato: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    attiva: { className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "Attiva" },
    sospesa: { className: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "In attesa" },
    disattivata: { className: "bg-red-500/15 text-red-400 border-red-500/30", label: "Disattivata" },
  };
  const v = variants[stato] ?? variants.sospesa;
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}