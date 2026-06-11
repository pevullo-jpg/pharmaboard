import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/oauth/gmail/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Collegamento Gmail" }] }),
  component: GmailCallbackPage,
});

function GmailCallbackPage() {
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Completamento del collegamento in corso…");

  useEffect(() => {
    // Il popup non condivide la sessione Supabase con l'opener (storage
    // partizionato), quindi non possiamo chiamare server functions protette
    // da qui. Inoltriamo code+state alla finestra principale autenticata.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const errorParam = params.get("error");

    const post = (payload: Record<string, unknown>) => {
      if (window.opener) {
        window.opener.postMessage(
          { type: "gmail-oauth-code", ...payload },
          window.location.origin,
        );
      }
    };

    if (errorParam) {
      const msg = errorParam === "access_denied" ? "Autorizzazione annullata." : `Errore Google: ${errorParam}`;
      setStatus("error");
      setMessage(msg);
      post({ ok: false, error: msg });
      setTimeout(() => window.close(), 2500);
      return;
    }
    if (!code || !state) {
      const msg = "Verifica di sicurezza fallita. Riprova dalla pagina Impostazioni.";
      setStatus("error");
      setMessage(msg);
      post({ ok: false, error: msg });
      setTimeout(() => window.close(), 2500);
      return;
    }

    setStatus("ok");
    setMessage("Autorizzazione ricevuta. Completamento in corso…");
    post({ ok: true, code, state });
    setTimeout(() => window.close(), 600);
  }, []);

  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground p-6">
      <div className="text-center space-y-4 max-w-sm">
        {status === "working" && <Loader2 className="size-8 animate-spin mx-auto text-muted-foreground" />}
        {status === "ok" && <CheckCircle2 className="size-8 mx-auto text-emerald-500" />}
        {status === "error" && <XCircle className="size-8 mx-auto text-destructive" />}
        <h1 className="text-lg font-semibold">Collegamento Gmail</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {status !== "working" && (
          <p className="text-xs text-muted-foreground">Puoi chiudere questa finestra.</p>
        )}
      </div>
    </div>
  );
}