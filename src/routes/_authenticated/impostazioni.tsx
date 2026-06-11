import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stethoscope, ChevronRight, ChevronDown, Package, RefreshCcw, Loader2, Mail, Unlink, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { reprocessExistingRicette } from "@/lib/gmail.functions";
import { getGmailConnection, startGmailConnect, disconnectGmail, completeGmailConnect } from "@/lib/gmail-oauth.functions";
import { toast } from "sonner";
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

      <GmailSection />

      <RielaborazioneSection />

      <MediciSection />
    </div>
  );
}

function GmailSection() {
  const qc = useQueryClient();
  const fetchConn = useServerFn(getGmailConnection);
  const start = useServerFn(startGmailConnect);
  const disconnect = useServerFn(disconnectGmail);
  const complete = useServerFn(completeGmailConnect);
  const [connecting, setConnecting] = useState(false);

  const { data: conn, isLoading } = useQuery({
    queryKey: ["gmail-connection"],
    queryFn: () => fetchConn(),
  });

  // Riceve code+state dal popup OAuth e completa qui (sessione autenticata).
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean; code?: string; state?: string; error?: string | null };
      if (data?.type !== "gmail-oauth-code") return;
      if (!data.ok || !data.code || !data.state) {
        setConnecting(false);
        toast.error(data.error ?? "Collegamento non riuscito");
        qc.invalidateQueries({ queryKey: ["gmail-connection"] });
        return;
      }
      try {
        const res = await complete({
          data: {
            code: data.code,
            state: data.state,
            redirectUri: `${window.location.origin}/oauth/gmail/callback`,
          },
        });
        toast.success(`Casella ${res.email ?? "Gmail"} collegata`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Collegamento non riuscito");
      } finally {
        setConnecting(false);
        qc.invalidateQueries({ queryKey: ["gmail-connection"] });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, complete]);

  const handleConnect = async () => {
    const popup = window.open("", "gmail-oauth", "width=600,height=720");
    if (!popup) {
      toast.error("Popup bloccato. Consenti i popup e riprova.");
      return;
    }
    setConnecting(true);
    try {
      const { authUrl } = await start({
        data: { redirectUri: `${window.location.origin}/oauth/gmail/callback` },
      });
      popup.location.href = authUrl;
      // Se l'utente chiude il popup senza completare, riabilita il pulsante.
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          setConnecting(false);
          qc.invalidateQueries({ queryKey: ["gmail-connection"] });
        }
      }, 700);
    } catch (e) {
      popup.close();
      setConnecting(false);
      toast.error(e instanceof Error ? e.message : "Errore di avvio del collegamento");
    }
  };

  const disconnectMut = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => {
      toast.success("Casella Gmail scollegata");
      qc.invalidateQueries({ queryKey: ["gmail-connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="glass-card p-6">
      <div className="flex gap-4">
        <div className="size-12 rounded-xl bg-accent/15 text-accent grid place-items-center shrink-0">
          <Mail className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold">Casella Gmail della farmacia</h2>
            {conn?.connected && (
              <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 gap-1">
                <CheckCircle2 className="size-3" /> Collegata
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            L'app analizza le email con allegato della casella collegata, applica le etichette{" "}
            <b>Valide</b>, <b>Scartate</b> e <b>Da verificare</b> direttamente in Gmail e importa nel
            gestionale solo le ricette valide.
          </p>

          {isLoading && <div className="text-sm text-muted-foreground">Caricamento…</div>}

          {!isLoading && conn && !conn.configured && (
            <p className="text-sm text-amber-400">
              Il collegamento Gmail non è ancora configurato dall'amministratore del servizio.
            </p>
          )}

          {!isLoading && conn?.configured && conn.connected && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Casella: </span>
                <span className="font-medium">{conn.email ?? "—"}</span>
              </div>
              <div className="text-xs text-muted-foreground space-x-3">
                {conn.connectedAt && (
                  <span>Collegata il {format(new Date(conn.connectedAt), "d MMM yyyy", { locale: it })}</span>
                )}
                {conn.lastSyncAt && (
                  <span>Ultima sincronizzazione: {format(new Date(conn.lastSyncAt), "d MMM yyyy HH:mm", { locale: it })}</span>
                )}
              </div>
              {conn.isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={disconnectMut.isPending}
                  onClick={() => {
                    if (window.confirm("Scollegare la casella Gmail? L'importazione automatica si fermerà.")) {
                      disconnectMut.mutate();
                    }
                  }}
                >
                  {disconnectMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                  Scollega
                </Button>
              )}
            </div>
          )}

          {!isLoading && conn?.configured && !conn.connected && (
            <div className="space-y-3">
              {conn.isOwner ? (
                <Button onClick={handleConnect} disabled={connecting} className="gap-2">
                  {connecting ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  {connecting ? "In attesa dell'autorizzazione…" : "Collega casella Gmail"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Solo il titolare della farmacia può collegare la casella Gmail.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function RielaborazioneSection() {
  const reprocess = useServerFn(reprocessExistingRicette);
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => reprocess(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["medici"] });
      toast.success(
        `Rielaborate ${r.processed} · aggiornate ${r.updated} · rimosse ${r.removedAltro} (non ricette) · duplicate ${r.removedDup}${r.failed ? ` · errori ${r.failed}` : ""}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="glass-card p-6">
      <div className="flex gap-4">
        <div className="size-12 rounded-xl bg-accent/15 text-accent grid place-items-center shrink-0">
          <RefreshCcw className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold">Rielaborazione dati</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Riapplica il riconoscimento aggiornato (CF + codice regionale + NRE + barcode Code39) ai documenti già in archivio, aggiorna i dati degli assistiti e rimuove i record incoerenti (non ricette e duplicati).
          </p>
          <Button
            onClick={() => {
              if (window.confirm("Procedere con la rielaborazione? Può richiedere alcuni minuti.")) mut.mutate();
            }}
            disabled={mut.isPending}
            className="gap-2"
          >
            {mut.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            {mut.isPending ? "Rielaborazione in corso…" : "Avvia rielaborazione"}
          </Button>
        </div>
      </div>
    </Card>
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