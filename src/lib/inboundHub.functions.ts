import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

/**
 * Restituisce l'email centrale (hub) collegata via connector + lo stato di
 * configurazione della farmacia corrente (email Gmail di inoltro registrata).
 */
export const getInboundHubInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: member } = await supabase
      .from("farmacia_members")
      .select("farmacia_id, farmacie(id, nome, email_inoltro, stato)")
      .eq("user_id", userId)
      .maybeSingle();
    const farmacia = (member?.farmacie as { id: string; nome: string; email_inoltro: string | null; stato: string } | null) ?? null;

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

    return {
      farmacia,
      hubEmail,
      hubError,
    };
  });

// ============ Admin: lista delle email arrivate da mittenti non associati ============
export const listInboundPending = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: admin } = await supabase
      .from("app_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
    if (!admin) throw new Error("Accesso negato");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: pending }, { data: farmacie }] = await Promise.all([
      supabaseAdmin.from("inbound_pending").select("*").eq("stato", "in_attesa").order("received_at", { ascending: false }),
      supabaseAdmin.from("farmacie").select("id, nome, email_inoltro, stato").order("nome"),
    ]);
    return { pending: pending ?? [], farmacie: farmacie ?? [] };
  });

// ============ Admin: assegna un'email pendente a una farmacia ============
const AssignSchema = z.object({
  pendingId: z.string().uuid(),
  farmaciaId: z.string().uuid(),
  rememberSender: z.boolean().default(true),
});

export const assignInboundPending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof AssignSchema>) => AssignSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: admin } = await supabase
      .from("app_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
    if (!admin) throw new Error("Accesso negato");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: pErr } = await supabaseAdmin
      .from("inbound_pending").select("*").eq("id", data.pendingId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!row) throw new Error("Email non trovata");

    // Memorizza l'indirizzo del forwarder sulla farmacia per il routing automatico futuro.
    if (data.rememberSender) {
      const senderEmail = (row.forwarded_for ?? row.from_email ?? "").trim().toLowerCase();
      if (senderEmail) {
        const { error: uErr } = await supabaseAdmin
          .from("farmacie").update({ email_inoltro: senderEmail }).eq("id", data.farmaciaId);
        if (uErr) throw new Error(`Aggiornamento email farmacia fallito: ${uErr.message}`);
      }
    }

    const { error: aErr } = await supabaseAdmin
      .from("inbound_pending")
      .update({ stato: "assegnata", assigned_farmacia_id: data.farmaciaId })
      .eq("id", data.pendingId);
    if (aErr) throw new Error(aErr.message);

    return { ok: true };
  });

// ============ Admin: scarta un'email pendente ============
export const dismissInboundPending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pendingId: string }) => z.object({ pendingId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: admin } = await supabase
      .from("app_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
    if (!admin) throw new Error("Accesso negato");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("inbound_pending").update({ stato: "scartata" }).eq("id", data.pendingId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });