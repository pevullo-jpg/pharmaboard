import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { completeGmailConnect } from "@/lib/gmail-oauth.functions";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/oauth/gmail/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Collegamento Gmail" }] }),
  component: GmailCallbackPage,
});

function GmailCallbackPage() {
  const complete = useServerFn(completeGmailConnect);
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Completamento del collegamento in corso…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const errorParam = params.get("error");
      const expectedState = sessionStorage.getItem("gmail_oauth_state");
      sessionStorage.removeItem("gmail_oauth_state");

      const finish = (ok: boolean, msg: string, email?: string | null) => {
        if (cancelled) return;
        setStatus(ok ? "ok" : "error");
        setMessage(msg);
        if (window.opener) {
          window.opener.postMessage(
            { type: "gmail-oauth-result", ok, email: email ?? null, error: ok ? null : msg },
            window.location.origin,
          );
          setTimeout(() => window.close(), ok ? 800 : 4000);
        }
      };

      if (errorParam) {
        finish(false, errorParam === "access_denied" ? "Autorizzazione annullata." : `Errore Google: ${errorParam}`);
        return;
      }
      if (!code) {
        finish(false, "Codice di autorizzazione mancante.");
        return;
      }
      if (!expectedState || state !== expectedState) {
        finish(false, "Verifica di sicurezza fallita. Riprova dalla pagina Impostazioni.");
        return;
      }

      try {
        const redirectUri = `${window.location.origin}/oauth/gmail/callback`;
        const res = await complete({ data: { code, redirectUri } });
        finish(true, `Casella ${res.email ?? "Gmail"} collegata con successo.`, res.email);
      } catch (e) {
        finish(false, e instanceof Error ? e.message : "Errore durante il collegamento.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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