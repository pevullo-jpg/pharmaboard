import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_mail";
// Workspace google_mail connection providing OAuth client credentials for App User flow.
const CONNECTOR_CLIENT_ID = "std_01ktghv6p2e1xbpbh4pe7g3pw9";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export const startGmailConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetOrigin: string; returnUrl: string }) =>
    z
      .object({
        targetOrigin: z.string().url(),
        returnUrl: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: context.userId,
      connectorClientId: CONNECTOR_CLIENT_ID,
      returnUrl: data.returnUrl,
      responseMode: "web_message",
      webMessageTargetOrigin: data.targetOrigin,
      credentialsConfiguration: { scopes: SCOPES },
    });
    return { authorizationUrl };
  });

export const saveGmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { connectionId: string }) =>
    z.object({ connectionId: z.string().min(1).max(128) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, gmail_connection_id: data.connectionId }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ gmail_connection_id: null })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
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
    const { supabase, userId } = context;

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("gmail_connection_id")
      .eq("id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile?.gmail_connection_id) {
      throw new Error("Gmail non collegato. Vai in Impostazioni e collega il tuo account.");
    }
    const connectionId = profile.gmail_connection_id;

    const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");

    // Last 30 days, prescriptions/DPC keywords with attachments.
    const query = encodeURIComponent("has:attachment newer_than:30d (ricetta OR prescrizione OR DPC)");
    const listRes = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionId,
      connectorId: CONNECTOR_ID,
      path: `/gmail/v1/users/me/messages?maxResults=25&q=${query}`,
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

      const msgRes = await callAsAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionId,
        connectorId: CONNECTOR_ID,
        path: `/gmail/v1/users/me/messages/${m.id}?format=full`,
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
        const attRes = await callAsAppUser({
          gatewayBaseUrl: GATEWAY_BASE_URL,
          connectionId,
          connectorId: CONNECTOR_ID,
          path: `/gmail/v1/users/me/messages/${m.id}/attachments/${attId}`,
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