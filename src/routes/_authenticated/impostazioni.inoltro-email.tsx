import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Copy, Check, Mail, Info, AlertCircle, Loader2 } from "lucide-react";
import { getInboundHubInfo } from "@/lib/inboundHub.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/impostazioni/inoltro-email")({
  head: () => ({ meta: [{ title: "Inoltro email · Farmacia" }] }),
  component: InoltroEmailPage,
});

function InoltroEmailPage() {
  const info = useServerFn(getInboundHubInfo);
  const { data, isLoading } = useQuery({
    queryKey: ["inbound-hub-info"],
    queryFn: () => info(),
  });

  const [copied, setCopied] = useState(false);
  const aliasEmail = data?.aliasEmail;

  async function copyAlias() {
    if (!aliasEmail) return;
    await navigator.clipboard.writeText(aliasEmail);
    setCopied(true);
    toast.success("Indirizzo copiato");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link to="/_authenticated/impostazioni" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-3">
          <ArrowLeft className="size-3.5" /> Impostazioni
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Inoltro email ricette</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configura la tua casella Gmail per inoltrare automaticamente solo le email contenenti ricette al nostro sistema.
        </p>
      </div>

      <Card className="glass-card p-6">
        <div className="flex gap-4">
          <div className="size-12 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shrink-0 accent-glow">
            <Mail className="size-6 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">Indirizzo di inoltro dedicato</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Questo è l'indirizzo univoco assegnato alla tua farmacia. Configura Gmail per inoltrare qui solo le email con ricette.
            </p>

            {isLoading && (
              <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Caricamento…
              </div>
            )}

            {!isLoading && data?.hubError && (
              <div className="text-sm text-destructive inline-flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                <AlertCircle className="size-4 shrink-0" />
                <span>Sistema non ancora pronto: {data.hubError}. Contatta l'assistenza.</span>
              </div>
            )}

            {!isLoading && aliasEmail && (
              <div className="flex items-stretch gap-2">
                <div className="flex-1 font-mono text-sm bg-sidebar-accent/40 border border-border/40 rounded-lg px-4 py-3 truncate">
                  {aliasEmail}
                </div>
                <Button onClick={copyAlias} variant="secondary" className="shrink-0">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  <span className="ml-2">{copied ? "Copiato" : "Copia"}</span>
                </Button>
              </div>
            )}

            {data?.farmacia?.stato && data.farmacia.stato !== "attiva" && (
              <Badge variant="outline" className="mt-3 text-destructive border-destructive/40">
                <AlertCircle className="size-3 mr-1" />
                Farmacia {data.farmacia.stato}: la ricezione non è attiva
              </Badge>
            )}
          </div>
        </div>
      </Card>

      <Card className="glass-card p-6">
        <h2 className="font-semibold mb-1">Configurazione Gmail (una sola volta)</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Esegui questi passaggi sulla casella Gmail della farmacia da cui ricevi le ricette.
        </p>

        <ol className="space-y-5">
          <Step n={1} title="Aggiungi l'indirizzo di inoltro">
            <p>In Gmail, vai su <strong>Impostazioni → Inoltro e POP/IMAP → Aggiungi un indirizzo di inoltro</strong>.</p>
            <p>Incolla l'indirizzo che ti abbiamo assegnato (il box sopra).</p>
            <p className="text-muted-foreground">Gmail invierà un codice di conferma a quell'alias. Noi lo riceveremo e te lo comunicheremo entro pochi minuti per confermare l'attivazione.</p>
          </Step>

          <Step n={2} title="Crea il filtro per le ricette">
            <p>In Gmail vai su <strong>Impostazioni → Filtri e indirizzi bloccati → Crea un nuovo filtro</strong>.</p>
            <p>Compila i criteri:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Campo <em>Contiene le parole</em>: <code className="bg-sidebar-accent/40 px-1.5 py-0.5 rounded">ricetta OR NRE OR prescrizione OR promemoria OR dematerializzata OR DPC</code></li>
              <li>Spunta <em>Contiene un allegato</em></li>
            </ul>
            <p>Clicca <strong>Crea filtro</strong>.</p>
          </Step>

          <Step n={3} title="Azione del filtro">
            <p>Nella schermata successiva spunta:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Inoltralo a</strong> → seleziona l'indirizzo aggiunto al passaggio 1</li>
              <li>(facoltativo) <strong>Applica etichetta</strong> → crea l'etichetta "Ricette inoltrate"</li>
            </ul>
            <p>Clicca <strong>Crea filtro</strong>. Da questo momento, solo le email che corrispondono ai criteri verranno inoltrate al nostro sistema. Le altre email restano normalmente nella tua casella.</p>
          </Step>

          <Step n={4} title="Verifica">
            <p>Aspetta che arrivi una nuova ricetta o invia tu stesso un test dalla casella. Entro 5 minuti la ricetta apparirà nella dashboard.</p>
          </Step>
        </ol>
      </Card>

      <Card className="glass-card p-4 flex gap-3 text-sm">
        <Info className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="text-muted-foreground">
          <strong className="text-foreground">Privacy:</strong> riceviamo solo le email che corrispondono al filtro che imposti tu. Non leggiamo né archiviamo nessun'altra email della tua casella. Non chiediamo password né accessi alla tua casella Gmail.
        </div>
      </Card>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="size-7 rounded-full bg-primary/15 text-primary grid place-items-center shrink-0 font-semibold text-sm">
        {n}
      </div>
      <div className="flex-1 space-y-2 text-sm">
        <h3 className="font-medium text-foreground">{title}</h3>
        <div className="text-muted-foreground space-y-2 [&_strong]:text-foreground [&_code]:text-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}