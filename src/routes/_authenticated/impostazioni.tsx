import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/impostazioni")({
  head: () => ({ meta: [{ title: "Impostazioni · Farmacia" }] }),
  component: ImpostazioniPage,
});

function ImpostazioniPage() {
  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.user.id).single();
      return data;
    },
  });

  const connected = !!profile?.gmail_connection_id;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Impostazioni</h1>
        <p className="text-sm text-muted-foreground mt-1">Collegamenti e preferenze dell'operatore</p>
      </div>

      <Card className="glass-card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex gap-4">
            <div className="size-12 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center shrink-0 accent-glow">
              <Mail className="size-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                Gmail {connected ? <Badge className="bg-accent/20 text-accent border border-accent/40">Connesso</Badge> : <Badge variant="outline">Non connesso</Badge>}
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Collega il tuo account Gmail per scaricare automaticamente le ricette ricevute. I dati vengono letti con AI: nome, cognome, CF, medico, esenzione, data e avviso DPC.
              </p>
            </div>
          </div>
          <Button
            onClick={() => toast.info("Collegamento Gmail in arrivo — chiedimi di attivarlo nella prossima iterazione.")}
            disabled={connected}
          >
            {connected ? "Connesso" : "Connetti il mio Gmail"}
          </Button>
        </div>
        <div className="mt-6 flex items-start gap-2 text-xs text-muted-foreground bg-sidebar-accent/40 rounded-lg p-3">
          <Info className="size-4 shrink-0 mt-0.5" />
          <div>
            L'autorizzazione è per-operatore: ogni utente collega il proprio Gmail. Per ora puoi aggiungere ricette manualmente dalla scheda assistito.
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