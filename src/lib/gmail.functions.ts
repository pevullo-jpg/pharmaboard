import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

// ---------- Codice fiscale: validazione formale + checksum ----------
const CF_REGEX = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
const CF_ODD: Record<string, number> = {
  "0":1,"1":0,"2":5,"3":7,"4":9,"5":13,"6":15,"7":17,"8":19,"9":21,
  A:1,B:0,C:5,D:7,E:9,F:13,G:15,H:17,I:19,J:21,K:2,L:4,M:18,N:20,
  O:11,P:3,Q:6,R:8,S:12,T:14,U:16,V:10,W:22,X:25,Y:24,Z:23,
};
const CF_EVEN: Record<string, number> = {
  "0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,
  A:0,B:1,C:2,D:3,E:4,F:5,G:6,H:7,I:8,J:9,K:10,L:11,M:12,N:13,
  O:14,P:15,Q:16,R:17,S:18,T:19,U:20,V:21,W:22,X:23,Y:24,Z:25,
};
const CF_OMOCODIA: Record<string, string> = { L:"0", M:"1", N:"2", P:"3", Q:"4", R:"5", S:"6", T:"7", U:"8", V:"9" };

export function normalizeCF(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cf = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cf.length !== 16) return null;
  if (!CF_REGEX.test(cf)) return null;
  // Validazione checksum (gestisce anche omocodia)
  const body = cf.slice(0, 15);
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = body[i];
    sum += (i % 2 === 0 ? CF_ODD[ch] : CF_EVEN[ch]);
  }
  const expected = String.fromCharCode("A".charCodeAt(0) + (sum % 26));
  if (expected !== cf[15]) return null;
  return cf;
}

// Estrae uno o più CF validi (con checksum) da un testo libero.
function extractValidCFs(text: string): string[] {
  const cleaned = text.toUpperCase().replace(/[\s\-_.]/g, "");
  const candidates = cleaned.match(/[A-Z0-9]{16}/g) ?? [];
  const out: string[] = [];
  for (const c of candidates) {
    const norm = normalizeCF(c);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

// ---------- Derivazione delle prime 6 lettere del CF da cognome+nome ----------
// Regole ufficiali del Ministero delle Finanze (DM 13/12/1976).
function stripName(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accenti
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}
function cfCodeCognome(cognome: string): string {
  const s = stripName(cognome);
  if (!s) return "XXX";
  const cons = s.replace(/[AEIOU]/g, "");
  const vow = s.replace(/[^AEIOU]/g, "");
  return (cons + vow + "XXX").slice(0, 3);
}
function cfCodeNome(nome: string): string {
  const s = stripName(nome);
  if (!s) return "XXX";
  const cons = s.replace(/[AEIOU]/g, "");
  const vow = s.replace(/[^AEIOU]/g, "");
  let picked: string;
  if (cons.length >= 4) picked = cons[0] + cons[2] + cons[3];
  else picked = (cons + vow + "XXX").slice(0, 3);
  return picked;
}
export function cfPrefixFromName(cognome: string, nome: string): string {
  return cfCodeCognome(cognome) + cfCodeNome(nome);
}
/**
 * Verifica che le prime 6 lettere del CF siano coerenti con cognome+nome.
 * Se uno dei due (o entrambi) sono vuoti, NON è possibile decidere → torna true
 * (per non scartare CF altrimenti validi).
 */
export function cfMatchesName(cf: string | null, cognome: string, nome: string): boolean {
  if (!cf) return false;
  const norm = normalizeCF(cf);
  if (!norm) return false;
  const cleanCog = stripName(cognome);
  const cleanNom = stripName(nome);
  if (!cleanCog || !cleanNom) return true;
  return norm.slice(0, 6) === cfPrefixFromName(cognome, nome);
}

/**
 * Sceglie da un elenco di CF validi quello le cui prime 6 lettere
 * corrispondono al cognome+nome dell'assistito. Se nessuno corrisponde,
 * torna null (probabilmente sono CF di medici/altri soggetti).
 */
function pickCFForName(cfs: string[], cognome: string, nome: string): string | null {
  if (cfs.length === 0) return null;
  const cleanCog = stripName(cognome);
  const cleanNom = stripName(nome);
  if (!cleanCog || !cleanNom) return cfs[0] ?? null;
  const target = cfPrefixFromName(cognome, nome);
  return cfs.find((c) => c.slice(0, 6) === target) ?? null;
}

/**
 * Risolve o crea un assistito per una farmacia. L'unico criterio di fusione è il
 * codice fiscale: se manca o non è valido, l'assistito NON viene creato.
 * La ricetta resta orfana e visibile in dashboard per intervento manuale.
 */
async function resolveOrCreateAssistito(args: {
  farmaciaId: string;
  cf: string | null;
  nome: string;
  cognome: string;
  medico: string | null;
  esenzione: string | null;
}): Promise<string | null> {
  if (!args.cf) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { farmaciaId, cf, nome, cognome, medico, esenzione } = args;

  // 1) Match esclusivamente per CF
  const { data: byCf } = await supabaseAdmin
    .from("assistiti")
    .select("id")
    .eq("farmacia_id", farmaciaId)
    .eq("codice_fiscale", cf)
    .maybeSingle();
  if (byCf) return byCf.id;

  // 2) Crea nuovo: serve almeno cognome o nome per intestare il record
  if (!cognome && !nome) return null;
  const { data: created, error: cErr } = await supabaseAdmin
    .from("assistiti")
    .insert({
      farmacia_id: farmaciaId,
      nome: nome || "(sconosciuto)",
      cognome: cognome || "(sconosciuto)",
      codice_fiscale: cf,
      medico,
      esenzione,
    })
    .select("id")
    .single();
  if (cErr) {
    // Race sull'unique index (farmacia_id, codice_fiscale): rileggi.
    console.error("Create assistito failed, retrying lookup", cErr.message);
    const { data: again } = await supabaseAdmin
      .from("assistiti")
      .select("id")
      .eq("farmacia_id", farmaciaId)
      .eq("codice_fiscale", cf)
      .maybeSingle();
    if (again) return again.id;
    return null;
  }
  return created?.id ?? null;
}

function gmailHeaders(extra?: HeadersInit): Headers {
  const apiKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.GOOGLE_MAIL_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  if (!connKey) throw new Error("Gmail della farmacia non collegato. Vai in Connettori e collega Gmail.");
  const h = new Headers(extra);
  h.set("Authorization", `Bearer ${apiKey}`);
  h.set("X-Connection-Api-Key", connKey);
  return h;
}

export const getGmailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const connected = !!process.env.GOOGLE_MAIL_API_KEY;
    if (!connected) return { connected: false as const };
    try {
      const res = await fetch(`${GATEWAY_URL}/users/me/profile`, { headers: gmailHeaders() });
      if (!res.ok) return { connected: false as const, error: `HTTP ${res.status}` };
      const j = (await res.json()) as { emailAddress?: string };
      return { connected: true as const, email: j.emailAddress ?? null };
    } catch (e) {
      return { connected: false as const, error: e instanceof Error ? e.message : "Errore" };
    }
  });

// ---------- Open / Delete ----------

export const getRicettaAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ricettaId: string }) => z.object({ ricettaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: r, error } = await supabase
      .from("ricette")
      .select("source_email_id")
      .eq("id", data.ricettaId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!r?.source_email_id) throw new Error("Ricetta senza email collegata");

    const msgRes = await fetch(`${GATEWAY_URL}/users/me/messages/${r.source_email_id}?format=full`, {
      headers: gmailHeaders(),
    });
    if (!msgRes.ok) throw new Error(`Gmail get failed (${msgRes.status})`);
    const msg = (await msgRes.json()) as GmailMessage;

    const atts = collectAttachmentParts(msg.payload?.parts);
    if (msg.payload?.body?.attachmentId && msg.payload.mimeType && (msg.payload.mimeType === "application/pdf" || msg.payload.mimeType.startsWith("image/"))) {
      atts.push({ mimeType: msg.payload.mimeType, body: msg.payload.body, filename: "ricetta" });
    }
    const att = atts[0];
    if (!att?.body?.attachmentId) throw new Error("Nessun allegato trovato nell'email");

    const attRes = await fetch(`${GATEWAY_URL}/users/me/messages/${r.source_email_id}/attachments/${att.body.attachmentId}`, {
      headers: gmailHeaders(),
    });
    if (!attRes.ok) throw new Error(`Attachment fetch failed (${attRes.status})`);
    const attData = (await attRes.json()) as { data?: string };
    if (!attData.data) throw new Error("Allegato vuoto");
    const base64 = base64UrlToBase64(attData.data);
    const mimeType = att.mimeType ?? "application/octet-stream";
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
      filename: att.filename ?? "ricetta",
    };
  });

export const deleteRicettaEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ricettaId: string }) => z.object({ ricettaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: r, error } = await supabase
      .from("ricette")
      .select("source_email_id")
      .eq("id", data.ricettaId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (r?.source_email_id) {
      const trashRes = await fetch(`${GATEWAY_URL}/users/me/messages/${r.source_email_id}/trash`, {
        method: "POST",
        headers: gmailHeaders(),
      });
      if (!trashRes.ok && trashRes.status !== 404) {
        const t = await trashRes.text();
        throw new Error(`Gmail trash failed (${trashRes.status}): ${t.slice(0, 200)}`);
      }
    }

    const { error: dErr } = await supabase.from("ricette").delete().eq("id", data.ricettaId);
    if (dErr) throw new Error(dErr.message);
    return { ok: true };
  });

// ---------- Merge all PDFs of an assistito ----------

async function fetchFirstAttachmentBytes(emailId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const msgRes = await fetch(`${GATEWAY_URL}/users/me/messages/${emailId}?format=full`, { headers: gmailHeaders() });
  if (!msgRes.ok) return null;
  const msg = (await msgRes.json()) as GmailMessage;
  const atts = collectAttachmentParts(msg.payload?.parts);
  if (msg.payload?.body?.attachmentId && msg.payload.mimeType && (msg.payload.mimeType === "application/pdf" || msg.payload.mimeType.startsWith("image/"))) {
    atts.push({ mimeType: msg.payload.mimeType, body: msg.payload.body });
  }
  const att = atts[0];
  if (!att?.body?.attachmentId) return null;
  const attRes = await fetch(`${GATEWAY_URL}/users/me/messages/${emailId}/attachments/${att.body.attachmentId}`, { headers: gmailHeaders() });
  if (!attRes.ok) return null;
  const j = (await attRes.json()) as { data?: string };
  if (!j.data) return null;
  const b64 = base64UrlToBase64(j.data);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mimeType: att.mimeType ?? "application/octet-stream" };
}

function normalizePersonValue(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function extractCfFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const found = extractValidCFs(text);
  return found[0] ?? null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export const getAssistitoMergedPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { assistitoId: string }) => z.object({ assistitoId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Carica l'assistito: il codice fiscale è la discriminante assoluta per fondere le ricette.
    const { data: ass, error: aErr } = await supabase
      .from("assistiti")
      .select("id, nome, cognome, codice_fiscale")
      .eq("id", data.assistitoId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!ass) throw new Error("Assistito non trovato");
    const assCf = normalizePersonValue(ass.codice_fiscale);
    if (!assCf || assCf.length !== 16) {
      throw new Error("L'assistito non ha un codice fiscale valido: impossibile fondere le ricette");
    }

    // Linked ricette
    const { data: linked, error: lErr } = await supabase
      .from("ricette")
      .select("id, source_email_id, data_ricetta, created_at")
      .eq("assistito_id", data.assistitoId)
      .not("source_email_id", "is", null);
    if (lErr) throw new Error(lErr.message);

    // Orfani: tutte le ricette non collegate con un'email sorgente.
    // Se manca il CF (estrazione AI fallita), lo riestraiamo dal PDF.
    const { data: orphanCandidates, error: oErr } = await supabase
      .from("ricette")
      .select("id, source_email_id, data_ricetta, created_at, codice_fiscale, raw_text")
      .is("assistito_id", null)
      .not("source_email_id", "is", null);
    if (oErr) throw new Error(oErr.message);

    const matchedOrphans: { id: string; source_email_id: string | null; data_ricetta: string | null; created_at: string | null; resolvedCf: string }[] = [];
    for (const r of orphanCandidates ?? []) {
      let cf = normalizePersonValue(r.codice_fiscale);
      if (cf.length !== 16) {
        // Prova a recuperare il CF dal raw_text salvato.
        cf = extractCfFromText(r.raw_text) ?? "";
      }
      if (cf.length !== 16 && r.source_email_id) {
        // Ultimo tentativo: ri-scarica l'allegato e ri-estrai con AI.
        try {
          const att = await fetchFirstAttachmentBytes(r.source_email_id);
          if (att) {
            const b64 = uint8ToBase64(att.bytes);
            const ext = await extractRicettaWithAI(b64, att.mimeType);
            const aiCf = normalizePersonValue(ext?.codice_fiscale);
            cf = aiCf.length === 16 ? aiCf : (extractCfFromText(JSON.stringify(ext)) ?? "");
            if (cf.length === 16) {
              await supabase.from("ricette").update({ codice_fiscale: cf }).eq("id", r.id);
            }
          }
        } catch (e) {
          console.error("Re-estrazione CF orfano fallita", r.id, e);
        }
      }
      if (cf === assCf) {
        matchedOrphans.push({ id: r.id, source_email_id: r.source_email_id, data_ricetta: r.data_ricetta, created_at: r.created_at, resolvedCf: cf });
      }
    }

    if (matchedOrphans.length > 0) {
      await supabase
        .from("ricette")
        .update({ assistito_id: data.assistitoId })
        .in("id", matchedOrphans.map((r) => r.id));
    }

    const orphans = matchedOrphans.map((r) => ({ id: r.id, source_email_id: r.source_email_id, data_ricetta: r.data_ricetta, created_at: r.created_at }));

    const ricette = [...(linked ?? []), ...orphans].sort((a, b) => {
      const da = a.data_ricetta ?? a.created_at ?? "";
      const db = b.data_ricetta ?? b.created_at ?? "";
      return da.localeCompare(db);
    });
    if (!ricette || ricette.length === 0) throw new Error("Nessuna ricetta con allegato per questo assistito");

    const { PDFDocument } = await import("pdf-lib");
    const merged = await PDFDocument.create();
    let added = 0;
    const errors: string[] = [];

    for (const r of ricette) {
      if (!r.source_email_id) continue;
      try {
        const att = await fetchFirstAttachmentBytes(r.source_email_id);
        if (!att) { errors.push(`Ricetta ${r.id}: allegato non trovato`); continue; }
        if (att.mimeType === "application/pdf") {
          const src = await PDFDocument.load(att.bytes, { ignoreEncryption: true });
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach((p) => merged.addPage(p));
          added++;
        } else if (att.mimeType === "image/jpeg" || att.mimeType === "image/jpg") {
          const img = await merged.embedJpg(att.bytes);
          const page = merged.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          added++;
        } else if (att.mimeType === "image/png") {
          const img = await merged.embedPng(att.bytes);
          const page = merged.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          added++;
        } else {
          errors.push(`Ricetta ${r.id}: tipo non supportato (${att.mimeType})`);
        }
      } catch (e) {
        errors.push(`Ricetta ${r.id}: ${e instanceof Error ? e.message : "errore"}`);
      }
    }

    if (added === 0) throw new Error(`Nessun PDF unito. ${errors.slice(0, 3).join(" | ")}`);

    const bytes = await merged.save();
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);
    return {
      dataUrl: `data:application/pdf;base64,${base64}`,
      mergedCount: added,
      skipped: ricette.length - added,
      errors,
    };
  });

// ---------- Sync ----------

type GmailMessageMeta = { id: string; threadId: string };
type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[]; parts?: GmailPart[]; mimeType?: string; body?: GmailPart["body"] };
};

function collectAttachmentParts(parts: GmailPart[] | undefined, acc: GmailPart[] = []): GmailPart[] {
  if (!parts) return acc;
  for (const p of parts) {
    if (p.body?.attachmentId && (p.mimeType === "application/pdf" || p.mimeType?.startsWith("image/"))) {
      acc.push(p);
    }
    if (p.parts) collectAttachmentParts(p.parts, acc);
  }
  return acc;
}

function base64UrlToBase64(b64url: string): string {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

const ExtractedSchema = z.object({
  nome: z.string().nullable().optional(),
  cognome: z.string().nullable().optional(),
  codice_fiscale: z.string().nullable().optional(),
  medico: z.string().nullable().optional(),
  esenzione: z.string().nullable().optional(),
  data_ricetta: z.string().nullable().optional(),
  numero_ricetta: z.string().nullable().optional(),
  dpc: z.boolean().nullable().optional(),
});

async function extractRicettaWithAI(base64: string, mimeType: string): Promise<z.infer<typeof ExtractedSchema> | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const prompt = `Sei un OCR specializzato in ricette mediche italiane (SSN). Estrai i campi dell'ASSISTITO (paziente), NON del medico né della farmacia.

Restituisci SOLO un JSON puro, senza markdown, in questo formato:
{
  "nome": string|null,            // nome dell'assistito
  "cognome": string|null,         // cognome dell'assistito
  "codice_fiscale": string|null,  // ESATTAMENTE il CF dell'assistito (16 caratteri, struttura: 6 lettere cognome+nome, 2 cifre anno, 1 lettera mese, 2 cifre giorno, 1 lettera comune, 3 cifre, 1 lettera controllo)
  "medico": string|null,          // cognome/nome del medico prescrittore
  "esenzione": string|null,       // codice esenzione (es. "007", "C05", "E01"), null se assente
  "data_ricetta": string|null,    // ISO YYYY-MM-DD
  "numero_ricetta": string|null,  // numero ricetta NRE/NIR (di solito 15 cifre)
  "dpc": boolean                  // true se compare la sigla DPC
}

REGOLE CRITICHE per il codice_fiscale:
- Sulla ricetta SSN ci sono spesso DUE codici fiscali: quello dell'ASSISTITO (in alto, sezione "Cognome e nome dell'assistito" / "Codice Fiscale Assistito") e quello del MEDICO (vicino alla firma / "Codice Fiscale Medico" / "Cod. Regionale"). DEVI restituire solo quello dell'ASSISTITO.
- Le prime 6 lettere del CF dell'assistito devono essere coerenti con cognome+nome estratti (3 consonanti del cognome + 3 consonanti del nome, con vocali in caso di carenza).
- Se hai dubbi, verifica che la 9ª posizione (lettera del mese) sia una di: A B C D E H L M P R S T.
- Se non riesci a leggere con certezza un CF di 16 caratteri valido, restituisci null. NON inventare.

Se un altro campo non è presente, usa null. Rispondi SOLO con il JSON.`;

  // Prima passata con modello veloce. Se il CF è mancante o non valido, riprova con il modello forte.
  const first = await callAIExtraction(apiKey, prompt, base64, mimeType, "google/gemini-2.5-flash");
  if (first && normalizeCF(first.codice_fiscale ?? null)) {
    first.codice_fiscale = normalizeCF(first.codice_fiscale ?? null);
    return first;
  }
  const retry = await callAIExtraction(apiKey, prompt, base64, mimeType, "google/gemini-2.5-pro");
  if (retry) {
    retry.codice_fiscale = normalizeCF(retry.codice_fiscale ?? null);
    return retry;
  }
  return first;
}

async function callAIExtraction(apiKey: string, prompt: string, base64: string, mimeType: string, model: string): Promise<z.infer<typeof ExtractedSchema> | null> {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`AI parse failed (${model})`, res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = ExtractedSchema.parse(JSON.parse(cleaned));
    // Se il CF restituito non è valido, prova a recuperarne uno valido dalla risposta grezza.
    if (!normalizeCF(parsed.codice_fiscale ?? null)) {
      const cfs = extractValidCFs(cleaned);
      if (cfs.length > 0) parsed.codice_fiscale = cfs[0];
    }
    return parsed;
  } catch {
    console.error(`AI JSON parse failed (${model}):`, cleaned.slice(0, 200));
    return null;
  }
}

export const syncGmailRicette = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return await runHubSync();
  });

/**
 * Sync the central hub Gmail inbox (es. ilfarmacista.info@gmail.com).
 * Per ogni email letta, estrae l'alias dal `To:` ("+farmaciaXXXX") e
 * indirizza la ricetta alla farmacia corrispondente.
 * Usa il client admin: bypassa RLS perché smista tra più tenant.
 */
export async function runHubSync(): Promise<{
  ok: true;
  checked: number;
  processedMessages: number;
  importedRicette: number;
  skipped: number;
  unmatched: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Tutte le ricette/prescrizioni con allegato negli ultimi 30 giorni.
  const query = encodeURIComponent("has:attachment newer_than:30d (ricetta OR prescrizione OR DPC)");
  const listRes = await fetch(`${GATEWAY_URL}/users/me/messages?maxResults=50&q=${query}`, {
    headers: gmailHeaders(),
  });
  if (!listRes.ok) {
    const t = await listRes.text();
    throw new Error(`Gmail list failed (${listRes.status}): ${t.slice(0, 200)}`);
  }
  const list = (await listRes.json()) as { messages?: GmailMessageMeta[] };
  const messages = list.messages ?? [];

  let processedMessages = 0;
  let importedRicette = 0;
  let skipped = 0;
  let unmatched = 0;

  // Carica le farmacie con email di inoltro registrata per il routing.
  const { data: farmacie } = await supabaseAdmin
    .from("farmacie")
    .select("id, email_inoltro, stato");
  const senderMap = new Map<string, { id: string; stato: string }>();
  for (const f of farmacie ?? []) {
    if (f.email_inoltro) senderMap.set(f.email_inoltro.toLowerCase(), { id: f.id, stato: f.stato });
  }

  for (const m of messages) {
    const { data: existing } = await supabaseAdmin
      .from("ricette")
      .select("id")
      .eq("source_email_id", m.id)
      .limit(1);
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const msgRes = await fetch(`${GATEWAY_URL}/users/me/messages/${m.id}?format=full`, {
      headers: gmailHeaders(),
    });
    if (!msgRes.ok) {
      console.error("Gmail get message failed", m.id, msgRes.status);
      continue;
    }
    const msg = (await msgRes.json()) as GmailMessage;
    processedMessages++;

    // Routing per mittente del forwarder: la farmacia inoltra dal proprio Gmail,
    // Gmail aggiunge `X-Forwarded-For: <email-farmacia>` al messaggio inoltrato.
    // Fallback su Return-Path / Sender / From per i casi edge.
    const headers = msg.payload?.headers ?? [];
    const headerVal = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    function extractEmail(raw: string): string | null {
      if (!raw) return null;
      const m = raw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
      return m ? m[0].toLowerCase() : null;
    }
    const senderCandidates = [
      extractEmail(headerVal("X-Forwarded-For")),
      extractEmail(headerVal("Return-Path")),
      extractEmail(headerVal("Sender")),
      extractEmail(headerVal("From")),
    ].filter((x): x is string => !!x);
    const subject = headerVal("Subject");
    const dateHeader = headerVal("Date");
    const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : null;
    const primarySender = senderCandidates[0] ?? null;

    let target: { id: string; stato: string } | undefined;
    for (const cand of senderCandidates) {
      const hit = senderMap.get(cand);
      if (hit) { target = hit; break; }
    }

    if (!target) {
      // Mittente sconosciuto: registra come pending per assegnazione manuale.
      await supabaseAdmin.from("inbound_pending").upsert({
        source_email_id: m.id,
        from_email: extractEmail(headerVal("From")),
        forwarded_for: extractEmail(headerVal("X-Forwarded-For")) ?? primarySender,
        subject,
        snippet: msg.snippet ?? null,
        received_at: receivedAt,
        stato: "in_attesa",
      }, { onConflict: "source_email_id" });
      unmatched++;
      continue;
    }
    if (target.stato !== "attiva") {
      console.warn("Hub sync: farmacia non attiva", target.id);
      unmatched++;
      continue;
    }
    const farmaciaId = target.id;

    const attachments = collectAttachmentParts(msg.payload?.parts);
    if (msg.payload?.body?.attachmentId && msg.payload.mimeType && (msg.payload.mimeType === "application/pdf" || msg.payload.mimeType.startsWith("image/"))) {
      attachments.push({ mimeType: msg.payload.mimeType, body: msg.payload.body, filename: subject });
    }

    if (attachments.length === 0) {
      skipped++;
      continue;
    }

    for (const att of attachments) {
      const attId = att.body?.attachmentId;
      if (!attId) continue;
      const attRes = await fetch(`${GATEWAY_URL}/users/me/messages/${m.id}/attachments/${attId}`, {
        headers: gmailHeaders(),
      });
      if (!attRes.ok) {
        console.error("Attachment fetch failed", attRes.status);
        continue;
      }
      const attData = (await attRes.json()) as { data?: string };
      if (!attData.data) continue;
      const base64 = base64UrlToBase64(attData.data);

      const mime = att.mimeType ?? "application/octet-stream";
      const extracted = await extractRicettaWithAI(base64, mime);
      if (!extracted) continue;

      let assistitoId: string | null = null;
      const cfValid = normalizeCF(extracted.codice_fiscale ?? null);
      const nome = (extracted.nome ?? "").trim();
      const cognome = (extracted.cognome ?? "").trim();
      assistitoId = await resolveOrCreateAssistito({
        farmaciaId,
        cf: cfValid,
        nome,
        cognome,
        medico: extracted.medico ?? null,
        esenzione: extracted.esenzione ?? null,
      });

      const isDpc = !!extracted.dpc;
      const { error: rErr } = await supabaseAdmin.from("ricette").insert({
        farmacia_id: farmaciaId,
        assistito_id: assistitoId,
        nome: extracted.nome ?? null,
        cognome: extracted.cognome ?? null,
        codice_fiscale: cfValid,
        medico: extracted.medico ?? null,
        esenzione: extracted.esenzione ?? null,
        data_ricetta: extracted.data_ricetta ?? null,
        numero_ricetta: extracted.numero_ricetta ?? null,
        dpc: isDpc,
        is_dpc_alert: isDpc,
        source: "gmail",
        source_email_id: m.id,
        stato: "nuova",
      });
      if (rErr) {
        console.error("Insert ricetta failed", rErr.message);
        continue;
      }
      importedRicette++;
    }
  }

  return {
    ok: true,
    checked: messages.length,
    processedMessages,
    importedRicette,
    skipped,
    unmatched,
  };
}