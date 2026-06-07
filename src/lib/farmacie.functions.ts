import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ Self: farmacia corrente dell'utente loggato ============
export const getMyFarmacia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdminRow } = await supabase
      .from("app_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .maybeSingle();
    const isSuperAdmin = !!isAdminRow;

    const { data: member } = await supabase
      .from("farmacia_members")
      .select("farmacia_id, ruolo, farmacie(id, nome, stato)")
      .eq("user_id", userId)
      .maybeSingle();

    if (!member) {
      return { isSuperAdmin, farmacia: null as null, ruolo: null as null };
    }
    const f = member.farmacie as { id: string; nome: string; stato: string } | null;
    return {
      isSuperAdmin,
      ruolo: member.ruolo,
      farmacia: f ? { id: f.id, nome: f.nome, stato: f.stato } : null,
    };
  });

// ============ Self-signup: crea utente + farmacia in stato sospesa ============
const RegisterSchema = z.object({
  // operatore
  email: z.string().email().max(255),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(120),
  // farmacia
  nome: z.string().min(1).max(200),
  ragioneSociale: z.string().max(200).optional().nullable(),
  partitaIva: z.string().max(20).optional().nullable(),
  indirizzo: z.string().max(200).optional().nullable(),
  citta: z.string().max(120).optional().nullable(),
  cap: z.string().max(10).optional().nullable(),
  telefono: z.string().max(40).optional().nullable(),
  emailContatto: z.string().email().max(255).optional().nullable(),
});

export const registerFarmacia = createServerFn({ method: "POST" })
  .inputValidator((d: z.infer<typeof RegisterSchema>) => RegisterSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. crea utente auth (auto-confirm: il gate reale è l'attivazione del super-admin)
    const { data: created, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.displayName },
    });
    if (uErr || !created.user) {
      throw new Error(uErr?.message ?? "Errore creazione account");
    }
    const userId = created.user.id;

    // 2. crea farmacia
    const { data: farm, error: fErr } = await supabaseAdmin
      .from("farmacie")
      .insert({
        nome: data.nome,
        ragione_sociale: data.ragioneSociale ?? null,
        partita_iva: data.partitaIva ?? null,
        indirizzo: data.indirizzo ?? null,
        citta: data.citta ?? null,
        cap: data.cap ?? null,
        telefono: data.telefono ?? null,
        email_contatto: data.emailContatto ?? data.email,
        stato: "sospesa",
      })
      .select("id")
      .single();
    if (fErr || !farm) {
      // rollback utente
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(fErr?.message ?? "Errore creazione farmacia");
    }

    // 3. associa utente come owner
    const { error: mErr } = await supabaseAdmin
      .from("farmacia_members")
      .insert({ user_id: userId, farmacia_id: farm.id, ruolo: "owner" });
    if (mErr) {
      await supabaseAdmin.from("farmacie").delete().eq("id", farm.id);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(mErr.message);
    }

    return { ok: true, farmaciaId: farm.id };
  });

// ============ Admin: lista tutte le farmacie ============
export const listAllFarmacie = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: admin } = await supabase
      .from("app_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
    if (!admin) throw new Error("Accesso negato");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: farm, error } = await supabaseAdmin
      .from("farmacie")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // conta membri e ricette per farmacia
    const ids = (farm ?? []).map((f) => f.id);
    const counts: Record<string, {
      members: number;
      ricette: number;
      assistiti: number;
      anticipi: number;
      prenotazioni: number;
      debiti: number;
      total: number;
    }> = {};
    for (const id of ids) counts[id] = {
      members: 0, ricette: 0, assistiti: 0, anticipi: 0, prenotazioni: 0, debiti: 0, total: 0,
    };
    if (ids.length > 0) {
      const [
        { data: members },
        { data: ricette },
        { data: assistiti },
        { data: anticipi },
        { data: prenotazioni },
        { data: debiti },
      ] = await Promise.all([
        supabaseAdmin.from("farmacia_members").select("farmacia_id").in("farmacia_id", ids),
        supabaseAdmin.from("ricette").select("farmacia_id").in("farmacia_id", ids),
        supabaseAdmin.from("assistiti").select("farmacia_id").in("farmacia_id", ids),
        supabaseAdmin.from("anticipi").select("farmacia_id").in("farmacia_id", ids),
        supabaseAdmin.from("prenotazioni").select("farmacia_id").in("farmacia_id", ids),
        supabaseAdmin.from("debiti").select("farmacia_id").in("farmacia_id", ids),
      ]);
      for (const m of members ?? []) counts[m.farmacia_id].members++;
      for (const r of ricette ?? []) counts[r.farmacia_id].ricette++;
      for (const a of assistiti ?? []) counts[a.farmacia_id].assistiti++;
      for (const a of anticipi ?? []) counts[a.farmacia_id].anticipi++;
      for (const p of prenotazioni ?? []) counts[p.farmacia_id].prenotazioni++;
      for (const d of debiti ?? []) counts[d.farmacia_id].debiti++;
      for (const id of ids) {
        const c = counts[id];
        c.total = c.ricette + c.assistiti + c.anticipi + c.prenotazioni + c.debiti;
      }
    }
    return { farmacie: farm ?? [], counts };
  });

// ============ Admin: cambia stato farmacia ============
const SetStatoSchema = z.object({
  farmaciaId: z.string().uuid(),
  stato: z.enum(["attiva", "sospesa", "disattivata"]),
  note: z.string().max(1000).optional().nullable(),
});

export const setFarmaciaStato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof SetStatoSchema>) => SetStatoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: admin } = await supabase
      .from("app_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
    if (!admin) throw new Error("Accesso negato");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const patch: {
      stato: "attiva" | "sospesa" | "disattivata";
      note_admin?: string | null;
      attivata_at?: string;
      sospesa_at?: string;
    } = { stato: data.stato };
    if (data.note !== undefined && data.note !== null) patch.note_admin = data.note;
    if (data.stato === "attiva") patch.attivata_at = now;
    if (data.stato === "sospesa" || data.stato === "disattivata") patch.sospesa_at = now;

    const { error } = await supabaseAdmin.from("farmacie").update(patch).eq("id", data.farmaciaId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Admin: imposta data di stop servizi ============
const SetDataStopSchema = z.object({
  farmaciaId: z.string().uuid(),
  dataStop: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const setFarmaciaDataStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof SetDataStopSchema>) => SetDataStopSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: admin } = await supabase
      .from("app_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
    if (!admin) throw new Error("Accesso negato");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("farmacie")
      .update({ data_stop_servizi: data.dataStop })
      .eq("id", data.farmaciaId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });