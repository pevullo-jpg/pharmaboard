import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Collegamento OAuth della casella Gmail PERSONALE della farmacia.
 * Il refresh token viene salvato in `farmacia_gmail_tokens` (tabella senza
 * grant per i client: accesso esclusivo via service role).
 */

// gmail.modify copre lettura, etichette e cestino (niente delete definitivo).
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

type Ctx = { supabase: { from: CallableFunction; rpc: CallableFunction }; userId: string };

async function getMembership(context: Ctx): Promise<{ farmaciaId: string; isOwner: boolean }> {
  const { data } = await (context.supabase as unknown as import("@supabase/supabase-js").SupabaseClient)
    .from("farmacia_members")
    .select("farmacia_id, ruolo")
    .eq("user_id", context.userId)
    .limit(1)
    .maybeSingle();
  if (!data?.farmacia_id) throw new Error("Nessuna farmacia associata all'utente");
  return { farmaciaId: data.farmacia_id as string, isOwner: data.ruolo === "owner" };
}

function requireOAuthCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Connessione Gmail non ancora configurata dall'amministratore del servizio");
  }
  return { clientId, clientSecret };
}

const RedirectUriSchema = z
  .string()
  .min(1)
  .max(500)
  .url()
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" && url.pathname === "/oauth/gmail/callback" && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, "redirectUri non valido");

/** Stato della connessione Gmail della farmacia corrente. */
export const getGmailConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { farmaciaId, isOwner } = await getMembership(context as unknown as Ctx);
    const configured = !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("farmacia_gmail_tokens")
      .select("gmail_email, connected_at, last_sync_at")
      .eq("farmacia_id", farmaciaId)
      .maybeSingle();
    return {
      configured,
      isOwner,
      connected: !!row,
      email: row?.gmail_email ?? null,
      connectedAt: row?.connected_at ?? null,
      lastSyncAt: row?.last_sync_at ?? null,
    };
  });

const StartSchema = z.object({
  redirectUri: RedirectUriSchema,
});

/** Costruisce l'URL di autorizzazione Google per il popup. */
export const startGmailConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof StartSchema>) => StartSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { farmaciaId, isOwner } = await getMembership(context as unknown as Ctx);
    if (!isOwner) throw new Error("Solo il titolare può collegare la casella Gmail");
    const { clientId } = requireOAuthCreds();

    // Lo stato anti-CSRF è generato e custodito lato server (il browser in
    // anteprima ha lo storage partizionato e non può condividerlo col popup).
    const state = crypto.randomUUID().replace(/-/g, "");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("gmail_oauth_states")
      .upsert({ farmacia_id: farmaciaId, state, created_at: new Date().toISOString() }, { onConflict: "farmacia_id" });
    if (error) throw new Error(error.message);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: data.redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  });

const CompleteSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  redirectUri: RedirectUriSchema,
});

/** Scambia il codice OAuth con i token e salva il collegamento. */
export const completeGmailConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof CompleteSchema>) => CompleteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { farmaciaId, isOwner } = await getMembership(context as unknown as Ctx);
    if (!isOwner) throw new Error("Solo il titolare può collegare la casella Gmail");
    const { clientId, clientSecret } = requireOAuthCreds();

    // Verifica server-side dello stato anti-CSRF.
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: stateRow } = await admin
      .from("gmail_oauth_states")
      .select("state, created_at")
      .eq("farmacia_id", farmaciaId)
      .maybeSingle();
    const fresh = stateRow?.created_at && Date.now() - new Date(stateRow.created_at).getTime() < 15 * 60 * 1000;
    if (!stateRow || stateRow.state !== data.state || !fresh) {
      throw new Error("Verifica di sicurezza fallita. Riprova dalla pagina Impostazioni.");
    }
    await admin.from("gmail_oauth_states").delete().eq("farmacia_id", farmaciaId);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: data.code,
        redirect_uri: data.redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error("Gmail code exchange failed", tokenRes.status, t.slice(0, 300));
      throw new Error("Autorizzazione Google non riuscita. Riprova.");
    }
    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!tokens.access_token) throw new Error("Autorizzazione Google non riuscita (token mancante)");
    if (!tokens.refresh_token) {
      throw new Error("Google non ha rilasciato l'autorizzazione permanente. Rimuovi l'accesso dell'app dal tuo account Google e riprova.");
    }
    if (!(tokens.scope ?? "").includes("gmail.modify")) {
      throw new Error("Permesso Gmail non concesso: spunta l'accesso alla casella durante l'autorizzazione.");
    }

    // Recupera l'indirizzo della casella collegata.
    const profRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const prof = profRes.ok ? ((await profRes.json()) as { emailAddress?: string }) : {};

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("farmacia_gmail_tokens").upsert({
      farmacia_id: farmaciaId,
      refresh_token: tokens.refresh_token,
      gmail_email: prof.emailAddress ?? null,
      connected_by: context.userId,
      connected_at: new Date().toISOString(),
    }, { onConflict: "farmacia_id" });
    if (error) throw new Error(error.message);

    return { ok: true as const, email: prof.emailAddress ?? null };
  });

/** Scollega la casella: revoca il token e cancella il collegamento. */
export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { farmaciaId, isOwner } = await getMembership(context as unknown as Ctx);
    if (!isOwner) throw new Error("Solo il titolare può scollegare la casella Gmail");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("farmacia_gmail_tokens")
      .select("refresh_token")
      .eq("farmacia_id", farmaciaId)
      .maybeSingle();

    if (row?.refresh_token) {
      try {
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: row.refresh_token }),
        });
      } catch (e) {
        console.warn("Gmail revoke failed", e instanceof Error ? e.message : e);
      }
    }

    const { error } = await supabaseAdmin
      .from("farmacia_gmail_tokens")
      .delete()
      .eq("farmacia_id", farmaciaId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });