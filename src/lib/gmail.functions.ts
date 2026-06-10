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
  if (byCf) {
    console.log("resolveAssistito: hit by CF", cf, "→", byCf.id);
    return byCf.id;
  }

  // 2) Crea nuovo: serve almeno cognome o nome per intestare il record
  if (!cognome && !nome) {
    console.warn("resolveAssistito: skip create — CF presente ma nome/cognome assenti", cf);
    return null;
  }
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
  console.log("resolveAssistito: created", cf, cognome, nome, "→", created?.id);
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

async function fetchAllAttachmentsBytes(emailId: string): Promise<{ bytes: Uint8Array; mimeType: string }[]> {
  const msgRes = await fetch(`${GATEWAY_URL}/users/me/messages/${emailId}?format=full`, { headers: gmailHeaders() });
  if (!msgRes.ok) return [];
  const msg = (await msgRes.json()) as GmailMessage;
  const atts = collectAttachmentParts(msg.payload?.parts);
  if (msg.payload?.body?.attachmentId && msg.payload.mimeType && (msg.payload.mimeType === "application/pdf" || msg.payload.mimeType.startsWith("image/"))) {
    atts.push({ mimeType: msg.payload.mimeType, body: msg.payload.body });
  }
  const out: { bytes: Uint8Array; mimeType: string }[] = [];
  for (const att of atts) {
    if (!att.body?.attachmentId) continue;
    const attRes = await fetch(`${GATEWAY_URL}/users/me/messages/${emailId}/attachments/${att.body.attachmentId}`, { headers: gmailHeaders() });
    if (!attRes.ok) continue;
    const j = (await attRes.json()) as { data?: string };
    if (!j.data) continue;
    const b64 = base64UrlToBase64(j.data);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    out.push({ bytes, mimeType: att.mimeType ?? "application/octet-stream" });
  }
  return out;
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
      .select("id, source_email_id, data_ricetta, created_at, tipo_documento, numero_ricetta")
      .eq("assistito_id", data.assistitoId)
      .not("source_email_id", "is", null);
    if (lErr) throw new Error(lErr.message);

    // Orfani: tutte le ricette non collegate con un'email sorgente.
    // Se manca il CF (estrazione AI fallita), lo riestraiamo dal PDF.
    const { data: orphanCandidates, error: oErr } = await supabase
      .from("ricette")
      .select("id, source_email_id, data_ricetta, created_at, codice_fiscale, raw_text, numero_ricetta")
      .is("assistito_id", null)
      .not("source_email_id", "is", null);
    if (oErr) throw new Error(oErr.message);

    const matchedOrphans: { id: string; source_email_id: string | null; data_ricetta: string | null; created_at: string | null; numero_ricetta: string | null; resolvedCf: string }[] = [];
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
        matchedOrphans.push({ id: r.id, source_email_id: r.source_email_id, data_ricetta: r.data_ricetta, created_at: r.created_at, numero_ricetta: r.numero_ricetta, resolvedCf: cf });
      }
    }

    if (matchedOrphans.length > 0) {
      await supabase
        .from("ricette")
        .update({ assistito_id: data.assistitoId })
        .in("id", matchedOrphans.map((r) => r.id));
    }

    const orphans = matchedOrphans.map((r) => ({ id: r.id, source_email_id: r.source_email_id, data_ricetta: r.data_ricetta, created_at: r.created_at, numero_ricetta: r.numero_ricetta, tipo_documento: null as string | null }));

    // Righe "ricetta" (gli orfani senza tipo li trattiamo come ricette) e righe "sintesi".
    const allLinked = (linked ?? []) as { id: string; source_email_id: string | null; data_ricetta: string | null; created_at: string | null; tipo_documento: string | null; numero_ricetta: string | null }[];
    const ricettaRows = [...allLinked.filter((r) => (r.tipo_documento ?? "ricetta") === "ricetta"), ...orphans].sort((a, b) => {
      const da = a.data_ricetta ?? a.created_at ?? "";
      const db = b.data_ricetta ?? b.created_at ?? "";
      return da.localeCompare(db);
    });
    const sintesiRows = allLinked.filter((r) => r.tipo_documento === "sintesi");

    // NRE distinti delle ricette vere e delle sintesi.
    const wantedNres = new Set<string>();
    for (const r of ricettaRows) { const n = normalizeNRE(r.numero_ricetta); if (n) wantedNres.add(n); }
    const sintesiNres = new Set<string>();
    for (const r of sintesiRows) { const n = normalizeNRE(r.numero_ricetta); if (n) sintesiNres.add(n); }
    // La sintesi va inclusa SOLO se contiene NRE diversi da quelli delle ricette.
    const includeSintesi = [...sintesiNres].some((n) => !wantedNres.has(n));

    if (ricettaRows.length === 0 && !includeSintesi) {
      return { empty: true as const, dataUrl: "", mergedCount: 0, skipped: 0, errors: [] };
    }

    // Email da scaricare: una per NRE distinto (più quelle delle sintesi se servono).
    const orderedEmails: string[] = [];
    const seenEmails = new Set<string>();
    const seenRowNres = new Set<string>();
    for (const r of ricettaRows) {
      if (!r.source_email_id) continue;
      const n = normalizeNRE(r.numero_ricetta);
      if (n) { if (seenRowNres.has(n)) continue; seenRowNres.add(n); }
      if (!seenEmails.has(r.source_email_id)) { seenEmails.add(r.source_email_id); orderedEmails.push(r.source_email_id); }
    }
    if (includeSintesi) {
      for (const r of sintesiRows) {
        if (r.source_email_id && !seenEmails.has(r.source_email_id)) { seenEmails.add(r.source_email_id); orderedEmails.push(r.source_email_id); }
      }
    }

    const { PDFDocument } = await import("pdf-lib");
    const { parsePdfRicetta } = await import("./ricette-parser.server");
    const merged = await PDFDocument.create();
    let added = 0;
    let sintesiAdded = false;
    const addedNres = new Set<string>();
    const errors: string[] = [];

    const addPdfPages = async (bytes: Uint8Array) => {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    };

    // Un'email può contenere allegati di PIÙ assistiti diversi: classifichiamo
    // OGNI allegato e includiamo solo quelli di questo assistito, una sola
    // volta per NRE. La sintesi entra al massimo una volta.
    for (const emailId of orderedEmails) {
      try {
        const atts = await fetchAllAttachmentsBytes(emailId);
        if (atts.length === 0) { errors.push(`Email ${emailId}: nessun allegato`); continue; }
        for (const att of atts) {
          try {
            if (att.mimeType === "application/pdf") {
              let doc: Awaited<ReturnType<typeof parsePdfRicetta>> = null;
              try { doc = await parsePdfRicetta(att.bytes); } catch { doc = null; }
              if (doc) {
                const attNres = (doc.prescrizioni ?? [])
                  .map((p) => canonicalNre(p.numero_ricetta, p.codice_regionale))
                  .filter((n): n is string => !!n);
                if (doc.tipo_documento === "sintesi") {
                  const belongs = attNres.some((n) => sintesiNres.has(n) || wantedNres.has(n));
                  if (includeSintesi && !sintesiAdded && belongs) {
                    await addPdfPages(att.bytes);
                    sintesiAdded = true;
                    added++;
                  }
                  continue;
                }
                if (doc.tipo_documento === "ricetta") {
                  const fresh = attNres.filter((n) => wantedNres.has(n) && !addedNres.has(n));
                  if (fresh.length > 0) {
                    await addPdfPages(att.bytes);
                    fresh.forEach((n) => addedNres.add(n));
                    added++;
                  }
                  continue;
                }
                // "altro": scarta sempre.
                continue;
              }
              // Non classificabile (scansione senza testo): includi solo se è
              // l'unico allegato dell'email (mappatura non ambigua).
              if (atts.length === 1) { await addPdfPages(att.bytes); added++; }
              else errors.push(`Email ${emailId}: allegato PDF non classificabile saltato`);
            } else if (att.mimeType === "image/jpeg" || att.mimeType === "image/jpg" || att.mimeType === "image/png") {
              if (atts.length === 1) {
                const img = att.mimeType === "image/png" ? await merged.embedPng(att.bytes) : await merged.embedJpg(att.bytes);
                const page = merged.addPage([img.width, img.height]);
                page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
                added++;
              } else {
                errors.push(`Email ${emailId}: immagine non classificabile saltata`);
              }
            } else {
              errors.push(`Email ${emailId}: tipo non supportato (${att.mimeType})`);
            }
          } catch (e) {
            errors.push(`Email ${emailId}: ${e instanceof Error ? e.message : "errore"}`);
          }
        }
      } catch (e) {
        errors.push(`Email ${emailId}: ${e instanceof Error ? e.message : "errore"}`);
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
    const mt = p.mimeType ?? "";
    const fn = (p.filename ?? "").toLowerCase();
    const isPdf = mt === "application/pdf" || (fn.endsWith(".pdf") && mt !== "application/pkcs7-signature");
    const isImg = mt.startsWith("image/");
    if (p.body?.attachmentId && (isPdf || isImg)) {
      acc.push(p);
    }
    // Scendi anche dentro multipart/related, multipart/alternative,
    // multipart/mixed e dentro le mail inoltrate (message/rfc822).
    if (p.parts) collectAttachmentParts(p.parts, acc);
  }
  return acc;
}

function base64UrlToBase64(b64url: string): string {
  return b64url.replace(/-/g, "+").replace(/_/g, "/");
}

/**
 * Una ricetta canonica salvabile DEVE avere: CF assistito valido,
 * nome+cognome assistito coerenti col CF (prime 6 lettere del CF),
 * medico, parola "prescrizione" e almeno un NRE valido.
 * REGOLA: NON ESISTE RICETTA SENZA CF ASSISTITO — niente CF, niente salvataggio.
 */
function isValidRicettaCanonica(ext: ExtractedDoc, cfValid: string | null): boolean {
  if (!cfValid) return false;
  const nome = (ext.nome ?? "").trim();
  const cognome = (ext.cognome ?? "").trim();
  if (!nome || !cognome) return false;
  if (!cfMatchesName(cfValid, cognome, nome)) return false;
  if (!(ext.medico ?? "").trim()) return false;
  if (!ext.keyword_prescrizione_trovata) return false;
  const pres = ext.prescrizioni ?? [];
  if (pres.length === 0 || !pres.some((p) => p.numero_ricetta)) return false;
  return true;
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

const PrescrizioneSchema = z.object({
  numero_ricetta: z.string().nullable().optional(),
  codice_regionale: z.string().nullable().optional(),
});
const ExtractedDocSchema = z.object({
  tipo_documento: z.enum(["ricetta", "sintesi", "altro"]).default("altro"),
  has_barcode_code39: z.boolean().nullable().optional(),
  nome: z.string().nullable().optional(),
  cognome: z.string().nullable().optional(),
  codice_fiscale: z.string().nullable().optional(),
  medico: z.string().nullable().optional(),
  esenzione: z.string().nullable().optional(),
  data_ricetta: z.string().nullable().optional(),
  dpc: z.boolean().nullable().optional(),
  prescrizioni: z.array(PrescrizioneSchema).default([]),
  keyword_prescrizione_trovata: z.boolean().nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
});
export type ExtractedDoc = z.infer<typeof ExtractedDocSchema>;

// NRE italiano = 5 caratteri alfanumerici (codice regionale, es. "1900A")
// + 10 cifre numeriche. Lunghezza totale: 15. NON è interamente numerico.
const NRE_REGEX = /\b[A-Z0-9]{5}\d{10}\b/;
function normalizeNRE(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5}\d{10}$/.test(s) ? s : null;
}
function normalizeRegionale(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // 5 caratteri alfanumerici esatti (es. "1900A").
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5}$/.test(s) ? s : null;
}

/**
 * NRE canonico = 15 caratteri = codice regionale (5 alfanumerici) + 10 cifre.
 * Se l'AI restituisce solo le 10 cifre della parte numerica e abbiamo il
 * codice regionale separato, li concateniamo. Se il NRE è già nel formato
 * canonico (15 char alfanumerici) lo restituiamo invariato.
 * Tutta la pipeline di insert/update/dedup deve passare attraverso questo
 * helper per evitare di salvare lo stesso NRE in due formati diversi
 * (es. "4963790679" vs "1900A4963790679") che farebbe sembrare la stessa
 * ricetta come due righe distinte in dashboard.
 */
function canonicalNre(numero: string | null | undefined, regionale: string | null | undefined): string | null {
  const num = (numero ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const reg = (regionale ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z0-9]{5}\d{10}$/.test(num)) return num;
  if (/^\d{10}$/.test(num) && /^\d{4}[A-Z0-9]$/.test(reg)) return reg + num;
  return null;
}

async function extractDocumentWithAI(base64: string, mimeType: string): Promise<ExtractedDoc | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const prompt = `Sei un OCR specializzato nei documenti del SSN italiano. Classifica il documento e estrai i dati con la MASSIMA precisione.

CLASSIFICAZIONE (tipo_documento):

1) "ricetta" — ricetta medica SSN (cartacea o promemoria DEM). Deve avere TUTTI questi elementi:
   a) codice fiscale ASSISTITO (16 char),
   b) nome E cognome dell'ASSISTITO leggibili,
   c) nome E cognome del MEDICO prescrittore leggibili (firma, timbro o intestazione),
   d) la parola "prescrizione" o "prescrizione medica" o "promemoria di prescrizione" deve comparire nel testo,
   e) codice NRE di 15 caratteri = codice regionale di 5 caratteri alfanumerici (es. "1900A", 4 cifre + 1 lettera) + 10 cifre numeriche,
   f) codice regionale di 5 caratteri alfanumerici (es. "1900A") sopra/accanto al barcode regionale,
   g) almeno UN barcode in formato Code39 (linee verticali nere).
   Se MANCA anche uno solo di a–g → NON è una ricetta canonica, classifica come "altro" o "sintesi" secondo i criteri sotto.

2) "sintesi" — foglio di riepilogo con SOLO:
   - un CF assistito,
   - una o più coppie (codice regionale 5 alfanumerici + NRE 15 caratteri).
   NESSUN dettaglio farmaco e NESSUN nome del medico. Tipicamente è una stampa di promemoria con elenco di ricette.

3) "altro" — qualsiasi altro documento (carte d'identità, tessere sanitarie, scontrini, referti, lettere, brochure, allegati firma, e qualsiasi documento che non rientri nei criteri di 1 o 2).

Restituisci SOLO JSON puro (no markdown), con questa forma:
{
  "tipo_documento": "ricetta" | "sintesi" | "altro",
  "confidence": "low" | "medium" | "high",
  "has_barcode_code39": boolean,
  "keyword_prescrizione_trovata": boolean,   // true se vedi la parola "prescrizione" nel documento
  "nome": string|null,                       // nome assistito
  "cognome": string|null,                    // cognome assistito
  "codice_fiscale": string|null,             // CF assistito (16 char), MAI quello del medico
  "medico": string|null,                     // cognome+nome del medico (solo per "ricetta")
  "esenzione": string|null,                  // codice esenzione (es "007","C05"), null se assente
  "data_ricetta": string|null,               // ISO YYYY-MM-DD
  "dpc": boolean,                            // true se compare la sigla DPC
  "prescrizioni": [
    { "numero_ricetta": "<5 alfanumerici + 10 cifre, totale 15>", "codice_regionale": "<5 alfanumerici>" }
  ]
}

REGOLE CRITICHE codice_fiscale assistito:
- Sulle ricette ci sono spesso 2 CF: assistito (in alto) e medico (vicino alla firma). Restituisci SOLO quello dell'assistito.
- Le prime 6 lettere del CF devono combaciare con cognome+nome (cognome: 3 consonanti, poi vocali, padding X; nome: se ≥4 consonanti prendi 1a,3a,4a, altrimenti consonanti+vocali+X). Es: ROSSI MARIO → RSSMRA.
- Se il CF letto NON rispetta queste 6 lettere, è il CF del medico: NON restituirlo, cerca il vero CF dell'assistito.
- Se non riesci a leggere un CF di 16 char valido, metti null. NON inventare.

REGOLE prescrizioni:
- "numero_ricetta" = NRE = ESATTAMENTE 15 caratteri = 5 caratteri alfanumerici (codice regionale, es. "1900A") + 10 cifre numeriche. Niente spazi/trattini. Esempio: "1900A4963790679".
- "codice_regionale" = ESATTAMENTE 5 caratteri alfanumerici. Es. "1900A" per la Sicilia.
- Se il documento contiene più NRE distinti ("sintesi"), restituiscili TUTTI come elementi separati.
- Se non è "ricetta" né "sintesi", restituisci [] e tipo_documento "altro".

Rispondi SOLO con il JSON.`;

  // Una sola chiamata sul modello veloce. Retry sul Pro SOLO se il primo output è
  // nullo/malformato o confidence bassa: niente retry "preventivo" → -50% costi AI.
  const first = await callDocExtraction(apiKey, prompt, base64, mimeType, "google/gemini-2.5-flash");
  const firstConfident =
    first &&
    first.confidence !== "low" &&
    (first.tipo_documento === "altro" || first.codice_fiscale);
  if (firstConfident) return first;
  const retry = await callDocExtraction(apiKey, prompt, base64, mimeType, "google/gemini-2.5-pro");
  return retry ?? first;
}

/**
 * Estrae da un allegato cercando prima la via deterministica (parser PDF
 * + regex sulle etichette SSN). Se il PDF è scansione pura o ambiguo,
 * oppure se è una immagine, fa fallback sull'AI vision.
 */
async function extractDocumentFromAttachment(base64: string, mimeType: string): Promise<ExtractedDoc | null> {
  if (mimeType === "application/pdf") {
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { parsePdfRicetta } = await import("./ricette-parser.server");
      const det = await parsePdfRicetta(bytes);
      if (det) {
        console.log("Parser deterministico ok:", det.tipo_documento, det.prescrizioni?.length ?? 0, "NRE");
        return det;
      }
      console.log("Parser deterministico: ambiguo o PDF immagine, fallback AI");
    } catch (e) {
      console.warn("Parser deterministico fallito, fallback AI:", e instanceof Error ? e.message : e);
    }
  }
  return extractDocumentWithAI(base64, mimeType);
}

async function callDocExtraction(apiKey: string, prompt: string, base64: string, mimeType: string, model: string): Promise<ExtractedDoc | null> {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ]}],
    }),
  });
  if (!res.ok) {
    console.error(`AI doc parse failed (${model})`, res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = ExtractedDocSchema.parse(JSON.parse(cleaned));
    parsed.codice_fiscale = normalizeCF(parsed.codice_fiscale ?? null);
    parsed.prescrizioni = (parsed.prescrizioni ?? [])
      .map((p) => ({
        numero_ricetta: normalizeNRE(p.numero_ricetta ?? null),
        codice_regionale: normalizeRegionale(p.codice_regionale ?? null),
      }))
      .filter((p) => p.numero_ricetta);
    // CF incoerente col nome → scarta CF (probabile medico)
    if (parsed.codice_fiscale && !cfMatchesName(parsed.codice_fiscale, parsed.cognome ?? "", parsed.nome ?? "")) {
      const cfs = extractValidCFs(cleaned);
      const matching = pickCFForName(cfs, parsed.cognome ?? "", parsed.nome ?? "");
      parsed.codice_fiscale = matching ?? null;
    }
    return parsed;
  } catch {
    console.error(`AI doc JSON parse failed (${model}):`, cleaned.slice(0, 200));
    return null;
  }
}

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
- Le prime 6 lettere del CF dell'assistito DEVONO essere coerenti con cognome+nome estratti, seguendo le regole ministeriali italiane:
  * Cognome (3 lettere): prime 3 consonanti in ordine; se non bastano, completa con le vocali in ordine; se ancora insufficienti, riempi con X.
  * Nome (3 lettere): se ha >=4 consonanti, prendi la 1a, 3a e 4a; altrimenti consonanti in ordine + vocali in ordine, padding con X.
  * Esempio: ROSSI MARIO → RSSMRA; DE LUCA ANNA → DLCNNA.
- Se il CF letto non rispetta queste prime 6 lettere rispetto a cognome+nome, è quasi certamente il CF del MEDICO o di un altro soggetto: NON restituirlo, cerca quello vero dell'assistito.
- Se hai dubbi, verifica che la 9ª posizione (lettera del mese) sia una di: A B C D E H L M P R S T.
- Se non riesci a leggere con certezza un CF di 16 caratteri valido, restituisci null. NON inventare.

Se un altro campo non è presente, usa null. Rispondi SOLO con il JSON.`;

  // Prima passata con modello veloce.
  const first = await callAIExtraction(apiKey, prompt, base64, mimeType, "google/gemini-2.5-flash");
  const firstOk =
    first &&
    normalizeCF(first.codice_fiscale ?? null) &&
    cfMatchesName(first.codice_fiscale ?? null, first.cognome ?? "", first.nome ?? "");
  if (firstOk) {
    first!.codice_fiscale = normalizeCF(first!.codice_fiscale ?? null);
    return first;
  }
  // Retry con modello forte: utile sia se il CF è illeggibile sia se sembra quello del medico.
  const retry = await callAIExtraction(apiKey, prompt, base64, mimeType, "google/gemini-2.5-pro");
  if (retry) {
    const cfNorm = normalizeCF(retry.codice_fiscale ?? null);
    if (cfNorm && !cfMatchesName(cfNorm, retry.cognome ?? "", retry.nome ?? "")) {
      // CF formalmente valido ma incoerente col nome → probabile CF del medico: scarta.
      retry.codice_fiscale = null;
    } else {
      retry.codice_fiscale = cfNorm;
    }
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
    const cfNorm = normalizeCF(parsed.codice_fiscale ?? null);
    const cog = parsed.cognome ?? "";
    const nom = parsed.nome ?? "";
    // Se il CF restituito non è valido OPPURE non corrisponde al nome dell'assistito
    // (probabile CF del medico), cerchiamo nella risposta grezza un CF coerente.
    if (!cfNorm || !cfMatchesName(cfNorm, cog, nom)) {
      const cfs = extractValidCFs(cleaned);
      const matching = pickCFForName(cfs, cog, nom);
      if (matching) {
        parsed.codice_fiscale = matching;
      } else if (cfNorm && cfMatchesName(cfNorm, nom, cog)) {
        // CF coerente se cognome/nome sono invertiti → applica lo swap
        parsed.cognome = nom;
        parsed.nome = cog;
        parsed.codice_fiscale = cfNorm;
      } else if (cfNorm && !cfMatchesName(cfNorm, cog, nom)) {
        // CF valido ma incoerente: probabilmente è il CF del medico.
        // Regola: nessuna ricetta senza CF assistito coerente → scarta CF.
        parsed.codice_fiscale = null;
      } else {
        parsed.codice_fiscale = cfNorm;
      }
    } else {
      parsed.codice_fiscale = cfNorm;
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
 * Rielabora con il classificatore aggiornato tutte le ricette già importate
 * dalla farmacia corrente (o tutte se super admin).
 * - Riscarica l'allegato originale via Gmail.
 * - Riclassifica come ricetta / sintesi / altro.
 * - "altro" → ricetta eliminata.
 * - "ricetta" / "sintesi" → aggiorna campi (NRE, regionale, CF, ...).
 * - Dedup per NRE per farmacia: tiene la più recente, elimina i duplicati.
 */
export const reprocessExistingRicette = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _uid: userId });
    const { data: myFarm } = await context.supabase.rpc("current_farmacia_id", { _uid: userId });

    let q = supabaseAdmin
      .from("ricette")
      .select("id, farmacia_id, source_email_id, numero_ricetta, created_at")
      .not("source_email_id", "is", null)
      .order("created_at", { ascending: true });
    if (!isSuper) {
      if (!myFarm) throw new Error("Farmacia non trovata");
      q = q.eq("farmacia_id", myFarm as string);
    }
    const { data: rows, error } = await q;
    if (error) throw error;

    let processed = 0;
    let updated = 0;
    let removedAltro = 0;
    let removedDup = 0;
    let failed = 0;

    // Cache per evitare di riscaricare lo stesso allegato più volte.
    const seenNre = new Map<string, string>(); // key = `${farmacia_id}|${nre}` → ricetta id

    for (const r of rows ?? []) {
      processed++;
      try {
        const att = await fetchFirstAttachmentBytes(r.source_email_id!);
        if (!att) { failed++; continue; }
        const base64 = uint8ToBase64(att.bytes);
        const ext = await extractDocumentFromAttachment(base64, att.mimeType);
        if (!ext) { failed++; continue; }

        if (ext.tipo_documento === "altro") {
          await supabaseAdmin.from("ricette").delete().eq("id", r.id);
          removedAltro++;
          continue;
        }

        const cfValid = normalizeCF(ext.codice_fiscale ?? null);
        const pres = ext.prescrizioni ?? [];
        if (pres.length === 0) { failed++; continue; }
        if (ext.tipo_documento === "ricetta" && !isValidRicettaCanonica(ext, cfValid)) {
          await supabaseAdmin.from("ricette").delete().eq("id", r.id);
          removedAltro++;
          continue;
        }

        // La prima prescrizione resta sulla riga esistente; eventuali NRE extra
        // (caso "sintesi" con più ricette) vengono inseriti come nuove righe,
        // saltando quelli già presenti per la stessa farmacia.
        const firstNre = canonicalNre(pres[0].numero_ricetta, pres[0].codice_regionale);
        if (!firstNre) { failed++; continue; }
        const [first, ...rest] = pres;
        const firstKey = `${r.farmacia_id}|${firstNre}`;
        const dupOwner = seenNre.get(firstKey);
        if (dupOwner && dupOwner !== r.id) {
          await supabaseAdmin.from("ricette").delete().eq("id", r.id);
          removedDup++;
          continue;
        }

        const assistitoId = await resolveOrCreateAssistito({
          farmaciaId: r.farmacia_id,
          cf: cfValid,
          nome: (ext.nome ?? "").trim(),
          cognome: (ext.cognome ?? "").trim(),
          medico: ext.medico ?? null,
          esenzione: ext.esenzione ?? null,
        });

        const isDpc = !!ext.dpc;
        const { error: uErr } = await supabaseAdmin
          .from("ricette")
          .update({
            assistito_id: assistitoId,
            nome: ext.nome ?? null,
            cognome: ext.cognome ?? null,
            codice_fiscale: cfValid,
            medico: ext.medico ?? null,
            esenzione: ext.esenzione ?? null,
            data_ricetta: ext.data_ricetta ?? null,
            numero_ricetta: firstNre,
            codice_regionale: first.codice_regionale ?? null,
            tipo_documento: ext.tipo_documento,
            dpc: isDpc,
          })
          .eq("id", r.id);
        if (uErr) { failed++; continue; }
        seenNre.set(firstKey, r.id);
        updated++;

        for (const p of rest) {
          const nreCanon = canonicalNre(p.numero_ricetta, p.codice_regionale);
          if (!nreCanon) continue;
          const key = `${r.farmacia_id}|${nreCanon}`;
          if (seenNre.has(key)) continue;
          const { data: existsNre } = await supabaseAdmin
            .from("ricette")
            .select("id")
            .eq("farmacia_id", r.farmacia_id)
            .eq("numero_ricetta", nreCanon)
            .limit(1);
          if (existsNre && existsNre.length > 0) {
            seenNre.set(key, existsNre[0].id);
            continue;
          }
          const { data: ins, error: iErr } = await supabaseAdmin.from("ricette").insert({
            farmacia_id: r.farmacia_id,
            assistito_id: assistitoId,
            nome: ext.nome ?? null,
            cognome: ext.cognome ?? null,
            codice_fiscale: cfValid,
            medico: ext.medico ?? null,
            esenzione: ext.esenzione ?? null,
            data_ricetta: ext.data_ricetta ?? null,
            numero_ricetta: nreCanon,
            codice_regionale: p.codice_regionale ?? null,
            tipo_documento: ext.tipo_documento,
            dpc: isDpc,
            is_dpc_alert: isDpc,
            source: "gmail",
            source_email_id: r.source_email_id,
            stato: "nuova",
          }).select("id").single();
          if (iErr || !ins) { failed++; continue; }
          seenNre.set(key, ins.id);
        }
      } catch (e) {
        console.error("Reprocess failed for ricetta", r.id, e);
        failed++;
      }
    }

    return { processed, updated, removedAltro, removedDup, failed };
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
    // Niente early-skip per source_email_id: una mail può contenere più
    // allegati e, se uno solo era stato importato (o un PDF era illeggibile
    // al primo passaggio), salteremmo per sempre gli altri. La dedup vera
    // avviene per (farmacia_id, numero_ricetta) più sotto.

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

    // Niente pre-filtro su subject/snippet/filename: ogni PDF/immagine
    // allegato viene scaricato e analizzato dal parser (deterministico o AI).
    console.log(`Hub sync: ${m.id} → ${attachments.length} allegato/i`, subject.slice(0, 60));

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
      const extracted = await extractDocumentFromAttachment(base64, mime);
      if (!extracted) { skipped++; continue; }

      // Filtra documenti non pertinenti.
      if (extracted.tipo_documento === "altro") { skipped++; continue; }

      const cfValidCheck = normalizeCF(extracted.codice_fiscale ?? null);
      if (extracted.tipo_documento === "ricetta") {
        if (!isValidRicettaCanonica(extracted, cfValidCheck)) {
          console.warn("Ricetta scartata: requisiti canonici mancanti", {
            cf: !!cfValidCheck,
            medico: !!(extracted.medico ?? "").trim(),
            keyword: !!extracted.keyword_prescrizione_trovata,
            barcode: !!extracted.has_barcode_code39,
            pres: (extracted.prescrizioni ?? []).length,
          });
          skipped++;
          continue;
        }
      } else if (extracted.tipo_documento === "sintesi") {
        const pres = extracted.prescrizioni ?? [];
        if (!cfValidCheck || pres.length === 0) { skipped++; continue; }
      }

      const cfValid = normalizeCF(extracted.codice_fiscale ?? null);
      const nome = (extracted.nome ?? "").trim();
      const cognome = (extracted.cognome ?? "").trim();
      const assistitoId = await resolveOrCreateAssistito({
        farmaciaId,
        cf: cfValid,
        nome,
        cognome,
        medico: extracted.medico ?? null,
        esenzione: extracted.esenzione ?? null,
      });

      const isDpc = !!extracted.dpc;
      const tipo = extracted.tipo_documento;

      for (const p of extracted.prescrizioni ?? []) {
        const nreCanon = canonicalNre(p.numero_ricetta, p.codice_regionale);
        if (!nreCanon) {
          console.warn("Skip prescrizione: NRE non canonico", p);
          continue;
        }
        // Dedup per NRE: una ricetta con stesso NRE non va reimportata.
        const { data: existsNre } = await supabaseAdmin
          .from("ricette")
          .select("id")
          .eq("farmacia_id", farmaciaId)
          .eq("numero_ricetta", nreCanon)
          .limit(1);
        if (existsNre && existsNre.length > 0) {
          // Sintesi: salta sempre. Ricetta full: salta comunque (è la stessa ricetta).
          skipped++;
          continue;
        }

        const { error: rErr } = await supabaseAdmin.from("ricette").insert({
          farmacia_id: farmaciaId,
          assistito_id: assistitoId,
          nome: extracted.nome ?? null,
          cognome: extracted.cognome ?? null,
          codice_fiscale: cfValid,
          medico: extracted.medico ?? null,
          esenzione: extracted.esenzione ?? null,
          data_ricetta: extracted.data_ricetta ?? null,
          numero_ricetta: nreCanon,
          codice_regionale: p.codice_regionale ?? null,
          tipo_documento: tipo,
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

      // Riallineo: se l'assistito è stato creato DOPO l'insert di una
      // sintesi orfana (o se è andato in race) ricolleghiamo tutte le
      // ricette di questo CF nella farmacia.
      if (cfValid && !assistitoId) {
        const { data: aRow } = await supabaseAdmin
          .from("assistiti")
          .select("id")
          .eq("farmacia_id", farmaciaId)
          .eq("codice_fiscale", cfValid)
          .maybeSingle();
        if (aRow) {
          await supabaseAdmin
            .from("ricette")
            .update({ assistito_id: aRow.id })
            .eq("farmacia_id", farmaciaId)
            .eq("codice_fiscale", cfValid)
            .is("assistito_id", null);
        }
      }
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