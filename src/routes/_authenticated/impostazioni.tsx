import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, ChevronRight, ChevronDown, Package, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { it } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/impostazioni")({
  head: () => ({ meta: [{ title: "Anticipi · Farmacia" }] }),
  component: ImpostazioniPage,
});

function ImpostazioniPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Gestione anticipi</h1>
      </div>

      <Link to="/impostazioni/inoltro-email" className="block">
        <Card className="glass-card p-5 hover:bg-sidebar-accent/30 transition-colors">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shrink-0 accent-glow">
              <Mail className="size-6 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Inoltro email ricette</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configura l'indirizzo di inoltro e rielabora le ricette già importate
              </p>
            </div>
            <ChevronRight className="size-5 text-muted-foreground shrink-0" />
          </div>
        </Card>
      </Link>

      <MediciSection />
    </div>
  );
}

function MediciSection() {
  const [openMedico, setOpenMedico] = useState<string | null>(null);

  const { data: medici, isLoading } = useQuery({
    queryKey: ["medici"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assistiti")
        .select("medico, id, nome, cognome, anticipi(id, farmaco, quantita, data_anticipo, stato, note)")
        .not("medico", "is", null);
      if (error) throw error;
      const map = new Map<string, { medico: string; assistiti: Array<{ id: string; nome: string; cognome: string; anticipi: Array<{ id: string; farmaco: string; quantita: number; data_anticipo: string; stato: string; note: string | null }> }> }>();
      for (const row of data ?? []) {
        const m = (row.medico ?? "").trim();
        if (!m) continue;
        if (!map.has(m)) map.set(m, { medico: m, assistiti: [] });
        const aperti = (row.anticipi ?? []).filter((a) => a.stato === "aperto");
        if (aperti.length > 0) {
          map.get(m)!.assistiti.push({ id: row.id, nome: row.nome, cognome: row.cognome, anticipi: aperti });
        }
      }
      return Array.from(map.values())
        .filter((m) => m.assistiti.length > 0)
        .sort((a, b) => a.medico.localeCompare(b.medico));
    },
  });

  return (
    <Card className="glass-card p-6">
      <div className="flex gap-4">
        <div className="size-12 rounded-xl bg-accent/15 text-accent grid place-items-center shrink-0">
          <Stethoscope className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold">Medici</h2>
          <p className="text-sm text-muted-foreground mt-1">Anticipi aperti raggruppati per medico</p>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {isLoading && <div className="text-sm text-muted-foreground">Caricamento…</div>}
        {!isLoading && (medici ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground">Nessun medico con anticipi aperti.</div>
        )}
        {(medici ?? []).map((m) => {
          const isOpen = openMedico === m.medico;
          const totaleAnticipi = m.assistiti.reduce((s, a) => s + a.anticipi.length, 0);
          return (
            <div key={m.medico} className="rounded-lg border border-border/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenMedico(isOpen ? null : m.medico)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-sidebar-accent/30 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                  <span className="font-medium truncate">Dr. {m.medico}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary">{m.assistiti.length} assistiti</Badge>
                  <Badge className="bg-accent/15 text-accent border border-accent/30">
                    <Package className="size-3 mr-1" /> {totaleAnticipi}
                  </Badge>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-border/40 bg-sidebar-accent/10 divide-y divide-border/40">
                  {m.assistiti.map((a) => (
                    <div key={a.id} className="px-4 py-3">
                      <div className="font-medium text-sm">{a.cognome} {a.nome}</div>
                      <div className="mt-2 space-y-1">
                        {a.anticipi.map((ant) => (
                          <div key={ant.id} className="text-xs flex items-center justify-between gap-3 text-muted-foreground">
                            <span className="truncate">
                              <span className="text-foreground">{ant.farmaco}</span> × {ant.quantita}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {format(new Date(ant.data_anticipo), "d MMM yyyy", { locale: it })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}