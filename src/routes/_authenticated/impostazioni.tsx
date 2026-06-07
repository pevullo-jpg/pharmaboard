import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Sparkles, Info, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { getGmailStatus } from "@/lib/gmail.functions";

export const Route = createFileRoute("/_authenticated/impostazioni")({
  head: () => ({ meta: [{ title: "Impostazioni · Farmacia" }] }),
  component: ImpostazioniPage,
});

function ImpostazioniPage() {
  const status = useServerFn(getGmailStatus);
  const { data, isLoading } = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => status(),
  });
  const connected = !!data?.connected;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Impostazioni</h1>
        <p className="text-sm text-muted-foreground mt-1">Collegamenti condivisi della farmacia</p>
      </div>

      <Card className="glass-card p-6">
        <div className="flex gap-4">
          <div className="size-12 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shrink-0 accent-glow">
            <Mail className="size-6 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold flex items-center gap-2 flex-wrap">
              Gmail della farmacia
              {isLoading ? (
                <Badge variant="outline"><Loader2 className="size-3 animate-spin mr-1" /> Verifica…</Badge>
              ) : connected ? (
                <Badge className="bg-accent/20 text-accent border border-accent/40">
                  <CheckCircle2 className="size-3 mr-1" /> Connesso
                </Badge>
              ) : (
                <Badge variant="outline" className="text-destructive border-destructive/40">
                  <AlertCircle className="size-3 mr-1" /> Non connesso
                </Badge>
              )}
            </h2>
            {connected && data?.email && (
              <p className="text-sm font-mono text-accent mt-1">{data.email}</p>
            )}
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              Tutti gli operatori della farmacia condividono la stessa casella Gmail. Le ricette ricevute vengono lette automaticamente con AI: nome, cognome, CF, medico, esenzione, data e avviso DPC.
            </p>
          </div>
        </div>
        <div className="mt-6 flex items-start gap-2 text-xs text-muted-foreground bg-sidebar-accent/40 rounded-lg p-3">
          <Info className="size-4 shrink-0 mt-0.5" />
          <div>
            Per cambiare la casella Gmail collegata, apri <strong>Connettori</strong> dalla barra laterale di Lovable e modifica la connessione Gmail della farmacia. Dopo il collegamento, vai in Dashboard e premi "Sincronizza Gmail".
          </div>
        </div>
      </Card>

      <Card className="glass-card p-6">
        <div className="flex gap-4">
          <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0">
            <Sparkles className="size-6" />
          </div>
          <div>
            <h2 className="font-semibold">Parsing AI</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Le ricette in PDF e immagini vengono interpretate con Gemini multimodale. Nessuna configurazione necessaria.
            </p>
            <Badge className="mt-3 bg-primary/15 text-primary border border-primary/30">Attivo</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}