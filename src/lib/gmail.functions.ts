import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

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

const CF_REGEX = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/;

function extractCfFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.toUpperCase().replace(/\s+/g, "").match(CF_REGEX);
  return m ? m[0] : null;
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

  const prompt = `Estrai dalla ricetta medica italiana i seguenti campi in JSON puro (no markdown):
{ "nome": string|null, "cognome": string|null, "codice_fiscale": string|null (16 caratteri), "medico": string|null, "esenzione": string|null, "data_ricetta": string|null (YYYY-MM-DD), "numero_ricetta": string|null, "dpc": boolean (true se compare la sigla DPC) }
Se un campo non è presente, usa null. Rispondi SOLO con il JSON.`;

  const dataUrl = `data:${mimeType};base64,${base64}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
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
    console.error("AI parse failed", res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = ExtractedSchema.parse(JSON.parse(cleaned));
    // Fallback: se il modello non ha estratto il CF, cercalo con regex nella risposta grezza.
    if (!parsed.codice_fiscale || parsed.codice_fiscale.replace(/\s+/g, "").length !== 16) {
      const cfFromRaw = cleaned.toUpperCase().replace(/\s+/g, "").match(/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/);
      if (cfFromRaw) parsed.codice_fiscale = cfFromRaw[0];
    }
    return parsed;
  } catch {
    console.error("AI JSON parse failed:", cleaned.slice(0, 200));
    return null;
  }
}

export const syncGmailRicette = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    // Last 30 days, prescriptions/DPC keywords with attachments.
    const query = encodeURIComponent("has:attachment newer_than:30d (ricetta OR prescrizione OR DPC)");
    const listRes = await fetch(`${GATEWAY_URL}/users/me/messages?maxResults=25&q=${query}`, {
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

    for (const m of messages) {
      // Skip if already imported.
      const { data: existing } = await supabase
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

      const subject = msg.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const attachments = collectAttachmentParts(msg.payload?.parts);
      // Also handle single-part messages with body.attachmentId at root.
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

        // Match assistito by codice fiscale (if present)
        let assistitoId: string | null = null;
        const cf = extracted.codice_fiscale?.trim().toUpperCase() ?? null;
        if (cf && cf.length === 16) {
          const { data: existingAss } = await supabase
            .from("assistiti")
            .select("id")
            .eq("codice_fiscale", cf)
            .maybeSingle();
          if (existingAss) {
            assistitoId = existingAss.id;
          } else if (extracted.nome || extracted.cognome) {
            const { data: created, error: cErr } = await supabase
              .from("assistiti")
              .insert({
                nome: extracted.nome ?? "",
                cognome: extracted.cognome ?? "",
                codice_fiscale: cf,
                medico: extracted.medico ?? null,
                esenzione: extracted.esenzione ?? null,
              })
              .select("id")
              .single();
            if (cErr) console.error("Create assistito failed", cErr.message);
            assistitoId = created?.id ?? null;
          }
        }

        const isDpc = !!extracted.dpc;
        const { error: rErr } = await supabase.from("ricette").insert({
          assistito_id: assistitoId,
          nome: extracted.nome ?? null,
          cognome: extracted.cognome ?? null,
          codice_fiscale: cf,
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
    };
  });