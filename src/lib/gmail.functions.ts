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
    return ExtractedSchema.parse(JSON.parse(cleaned));
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