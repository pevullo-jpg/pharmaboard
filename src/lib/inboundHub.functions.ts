import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

/**
 * Restituisce l'email centrale (hub) collegata via connector + l'alias della
 * farmacia corrente, per costruire l'indirizzo `hub+alias@dominio` da mostrare
 * nelle istruzioni di inoltro.
 */
export const getInboundHubInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: member } = await supabase
      .from("farmacia_members")
      .select("farmacia_id, farmacie(id, nome, alias_inbound, stato)")
      .eq("user_id", userId)
      .maybeSingle();
    const farmacia = (member?.farmacie as { id: string; nome: string; alias_inbound: string; stato: string } | null) ?? null;

    // Hub email dal connector Gmail (LOVABLE_API_KEY + GOOGLE_MAIL_API_KEY già configurati a livello workspace).
    let hubEmail: string | null = null;
    let hubError: string | null = null;
    const apiKey = process.env.LOVABLE_API_KEY;
    const connKey = process.env.GOOGLE_MAIL_API_KEY;
    if (apiKey && connKey) {
      try {
        const res = await fetch(`${GATEWAY_URL}/users/me/profile`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-Connection-Api-Key": connKey,
          },
        });
        if (res.ok) {
          const j = (await res.json()) as { emailAddress?: string };
          hubEmail = j.emailAddress ?? null;
        } else {
          hubError = `HTTP ${res.status}`;
        }
      } catch (e) {
        hubError = e instanceof Error ? e.message : "Errore";
      }
    } else {
      hubError = "Connettore Gmail non configurato";
    }

    let aliasEmail: string | null = null;
    if (hubEmail && farmacia?.alias_inbound) {
      const [local, domain] = hubEmail.split("@");
      if (local && domain) aliasEmail = `${local}+${farmacia.alias_inbound}@${domain}`;
    }

    return {
      farmacia,
      hubEmail,
      hubError,
      aliasEmail,
    };
  });