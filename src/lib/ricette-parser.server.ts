import { extractText, getDocumentProxy } from "unpdf";
import { normalizeCF, cfMatchesName, cfPrefixFromName, type ExtractedDoc } from "./gmail.functions";

/**
 * Parser deterministico per ricette/promemoria/sintesi SSN italiani.
 * Restituisce null se il PDF non ha testo estraibile (scansione pura) o
 * se non è classificabile con sufficiente certezza → l'AI vision farà fallback.
 */
export async function parsePdfRicetta(bytes: Uint8Array): Promise<ExtractedDoc | null> {
  let rawText = "";
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    rawText = Array.isArray(text) ? text.join("\n") : text;
  } catch (e) {
    console.warn("parsePdfRicetta: PDF non leggibile", e instanceof Error ? e.message : e);
    return null;
  }

  if (!rawText || rawText.replace(/\s/g, "").length < 30) {
    // PDF immagine senza layer testo → lascia all'AI.
    return null;
  }

  return classifyAndExtract(rawText);
}

// Esportata anche per test su testo già estratto.
export function classifyAndExtract(rawText: string): ExtractedDoc | null {
  const text = rawText.replace(/\r/g, "");
  const upper = text.toUpperCase();

  const hasPrescrizioneWord = /PRESCRIZ/i.test(text);
  const hasPromemoriaHeader = /RICETTA\s+ELETTRONICA[^a-z]*PROMEMORIA/i.test(upper);
  const hasSSNHeader = /SERVIZIO\s+SANITARIO\s+NAZIONALE/i.test(upper);
  const hasElencoNre = /\bN\s*R\s*E\b/i.test(text) && /PIN[\s\-]?NRBE/i.test(text);

  // Estrai TUTTI gli NRE (5 alfanumerici + 10 cifre, con eventuale spazio).
  const nres = extractNREs(text);

  // Sintesi: header tipico + nessun blocco PRESCRIZIONE/farmaco.
  const looksLikeSintesi =
    hasElencoNre &&
    !/(\bQTA\b|\bN\.\s*CONFEZIONI\b|COMPRESSE|CAPSULE|FLACONE|MG\b|\bUI\b)/i.test(text);

  if (looksLikeSintesi && nres.length > 0) {
    const cf = pickAssistitoCf(text, "", "");
    if (!cf) return null; // sintesi senza CF non è utilizzabile
    return {
      tipo_documento: "sintesi",
      has_barcode_code39: true,
      keyword_prescrizione_trovata: true,
      codice_fiscale: cf,
      nome: null,
      cognome: null,
      medico: null,
      esenzione: null,
      data_ricetta: null,
      dpc: /\bDPC\b/i.test(text),
      prescrizioni: nres.map((n) => ({ numero_ricetta: n.full, codice_regionale: n.reg })),
      confidence: "high",
    };
  }

  // Ricetta canonica: header SSN o promemoria + NRE + parola prescrizione.
  if ((hasSSNHeader || hasPromemoriaHeader) && hasPrescrizioneWord && nres.length > 0) {
    const { nome, cognome } = parseAssistitoName(text);
    const medico = parseMedico(text);
    const esenzione = parseEsenzione(text);
    const dataRicetta = parseData(text);
    const cfMedico = parseCfMedico(text);
    const cf = pickAssistitoCf(text, cognome ?? "", nome ?? "", cfMedico ? [cfMedico] : []);

    if (!nome || !cognome || !medico) {
      // Dati minimi mancanti: lascia all'AI per il retry.
      return null;
    }

    return {
      tipo_documento: "ricetta",
      has_barcode_code39: true,
      keyword_prescrizione_trovata: true,
      codice_fiscale: cf,
      nome,
      cognome,
      medico,
      esenzione,
      data_ricetta: dataRicetta,
      dpc: /\bDPC\b/i.test(text),
      prescrizioni: nres.map((n) => ({ numero_ricetta: n.full, codice_regionale: n.reg })),
      confidence: "high",
    };
  }

  // Nessun pattern noto: classifica "altro" SOLO se non vediamo segnali SSN forti.
  if (!hasSSNHeader && !hasPromemoriaHeader && !hasElencoNre && nres.length === 0) {
    return {
      tipo_documento: "altro",
      has_barcode_code39: false,
      keyword_prescrizione_trovata: false,
      codice_fiscale: null,
      nome: null,
      cognome: null,
      medico: null,
      esenzione: null,
      data_ricetta: null,
      dpc: false,
      prescrizioni: [],
      confidence: "high",
    };
  }

  // Ambiguo: lascia all'AI.
  return null;
}

// ---------- helpers ----------

const NRE_RE = /\b([A-Z0-9]{5})[\s]*?(\d{10})\b/g;

function extractNREs(text: string): { full: string; reg: string }[] {
  // Pre-normalizza: asterischi (delimitatori barcode "*1900A* *4964766295*")
  // e altri segni di punteggiatura non-alfanumerica diventano spazi.
  const compact = text.toUpperCase().replace(/[^A-Z0-9\s]/g, " ");
  const out: { full: string; reg: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  NRE_RE.lastIndex = 0;
  while ((m = NRE_RE.exec(compact))) {
    const reg = m[1];
    const num = m[2];
    // Scarta combinazioni che sono palesemente CF/numeri telefonici:
    // il codice regionale deve contenere almeno una lettera o iniziare con cifre 1-9
    // e non essere parte di un CF (16 char) o di un CAP/numero a sé.
    if (!/[A-Z]/.test(reg) && !/^\d{4}[A-Z0-9]$/.test(reg)) {
      // accetta solo se sembra un codice regionale plausibile
      // (es. 1900A, 0301G ecc.); altrimenti skip se è solo 15 cifre random
      continue;
    }
    const full = reg + num;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ full, reg });
  }
  // Fallback: cerca anche pattern "puro 15 cifre" tipici di alcuni vecchi NRE.
  if (out.length === 0) {
    const m2 = compact.match(/\b\d{15}\b/g);
    if (m2) {
      for (const v of m2) {
        if (seen.has(v)) continue;
        seen.add(v);
        out.push({ full: v, reg: v.slice(0, 5) });
      }
    }
  }
  return out;
}

function takeLineAfter(text: string, labelRegex: RegExp, stops?: RegExp): string | null {
  const m = text.match(labelRegex);
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length;
  const tail = text.slice(start);
  // taglia al prossimo newline o etichetta in maiuscolo seguita da ":"
  const stopIdx = (() => {
    const candidates: number[] = [];
    const nl = tail.indexOf("\n");
    if (nl >= 0) candidates.push(nl);
    if (stops) {
      const s = tail.match(stops);
      if (s && s.index !== undefined) candidates.push(s.index);
    } else {
      const generic = tail.match(/\s{2,}[A-Z][A-Z' .]{2,}:/);
      if (generic && generic.index !== undefined) candidates.push(generic.index);
    }
    if (candidates.length === 0) return tail.length;
    return Math.min(...candidates);
  })();
  return tail.slice(0, stopIdx).trim() || null;
}

function parseAssistitoName(text: string): { nome: string | null; cognome: string | null } {
  // Etichetta tipica: "COGNOME E NOME/INIZIALI DELL'ASSISTITO: COGNOME NOME"
  const raw = takeLineAfter(
    text,
    /COGNOME\s+E\s+NOME[^:]*ASSISTITO\s*:\s*/i,
    /\s{2,}[A-Z][A-Z' .]+:/,
  );
  if (!raw) return { nome: null, cognome: null };
  const parts = raw
    .replace(/[^A-ZÀ-Ÿ' \-]/gi, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { nome: null, cognome: null };
  if (parts.length === 1) return { nome: null, cognome: parts[0].toUpperCase() };
  // Convenzione SSN: cognome (1-2 token) poi nome (1-2 token).
  // Usiamo lo split semplice: ultimo token = nome, resto = cognome.
  const nome = parts[parts.length - 1].toUpperCase();
  const cognome = parts.slice(0, -1).join(" ").toUpperCase();
  return { nome, cognome };
}

function parseMedico(text: string): string | null {
  const raw = takeLineAfter(
    text,
    /COGNOME\s+E\s+NOME\s+DEL\s+MEDICO\s*:\s*/i,
    /\s{2,}[A-Z][A-Z' .]+:/,
  );
  if (!raw) return null;
  return raw
    .replace(/[^A-ZÀ-Ÿ' \-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase() || null;
}

function parseEsenzione(text: string): string | null {
  const raw = takeLineAfter(
    text,
    /ESENZIONE\s*:\s*/i,
    /(SIGLA\s+PROVINCIA|CODICE\s+ASL|DISPOSIZIONI\s+REGIONALI|\n)/i,
  );
  if (!raw) return null;
  const v = raw.replace(/\s+/g, "").toUpperCase();
  if (!v || /^N(ON)?$/.test(v)) return null;
  // formato tipico: 1-3 caratteri alfanumerici (es "E01", "C02", "007")
  const m = v.match(/^[A-Z0-9]{2,5}/);
  return m ? m[0] : null;
}

function parseData(text: string): string | null {
  // "DATA: 04/06/2026" → 2026-06-04
  const m = text.match(/\bDATA\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseCfMedico(text: string): string | null {
  const m = text.match(/CODICE\s+FISCALE\s+DEL\s+MEDICO\s*:?\s*([A-Z0-9]{16})/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Sceglie il CF dell'assistito: cerca tutti i CF validi nel testo, scarta
 * quello esplicitamente etichettato come "del medico" e quelli che non
 * combaciano con cognome+nome. Se nessuno combacia ma c'è un CF non-medico
 * unico → lo ritorna comunque.
 */
function pickAssistitoCf(text: string, cognome: string, nome: string, exclude: string[] = []): string | null {
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const candidates = cleaned.match(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/g) ?? [];
  const norm = Array.from(new Set(candidates))
    .map((c) => normalizeCF(c))
    .filter((c): c is string => !!c)
    .filter((c) => !exclude.includes(c));
  if (norm.length === 0) return null;
  if (cognome && nome) {
    const target = cfPrefixFromName(cognome, nome);
    const matching = norm.find((c) => c.slice(0, 6) === target);
    if (matching) return matching;
    // nessun match esatto: non rischiare, ritorna null (sarà gestito come orfano)
    if (norm.length > 1) return null;
  }
  // un solo CF valido e nessun nome di riferimento: lo accettiamo
  return norm[0];
}

// Riesporta utilità CF per chi importa solo questo modulo (test, ecc.)
export { normalizeCF, cfMatchesName };