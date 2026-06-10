import { extractText, getDocumentProxy } from "unpdf";
import { normalizeCF, cfMatchesName, cfPrefixFromName, type ExtractedDoc } from "./gmail.functions";

/**
 * Parser deterministico per ricette/promemoria/sintesi SSN italiani.
 * Strategia: estraiamo il testo del PDF con unpdf (che concatena tutto su
 * un'unica riga), poi usiamo un set di label SSN note come delimitatori per
 * isolare il valore di ciascun campo (label-to-label window).
 * Restituisce null SOLO se il PDF non ha layer di testo (scansione pura) o
 * se nessun marker SSN è presente; l'AI vision farà fallback negli altri casi.
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

  // Tentiamo SEMPRE la classificazione, anche se il layer di testo è scarno
  // (PDF "ibridi" / quasi-immagine): se è davvero vuoto, classifyAndExtract
  // ritornerà null da solo. Non abbiamo più fallback AI, quindi non
  // dobbiamo rinunciare a priori.
  return classifyAndExtract(rawText ?? "");
}

// Esportata anche per test su testo già estratto.
export function classifyAndExtract(rawText: string): ExtractedDoc | null {
  const text = rawText.replace(/\r/g, "");
  const upper = text.toUpperCase();

  const hasPromemoriaHeader = /RICETTA\s+ELETTRONICA[^A-Z]*PROMEMORIA/i.test(upper);
  const hasSSNHeader = /SERVIZIO\s+SANITARIO\s+NAZIONALE/i.test(upper);
  const hasElencoNre = /PIN[\s\-]?NRBE/i.test(text);
  const hasRicettaLabels =
    /COGNOME\s+E\s+NOME[^:]{0,40}ASSISTITO/i.test(text) &&
    /CODICE\s+FISCALE\s+DEL\s+MEDICO/i.test(text);

  // NRE: cerchiamo TUTTI gli NRE plausibili (codice regionale 5 char + 10 cifre).
  const nres = extractNREs(text);

  // Nessun marker SSN: documento estraneo → AI deciderà.
  if (!hasSSNHeader && !hasPromemoriaHeader && !hasElencoNre && !hasRicettaLabels && nres.length === 0) {
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

  // --- SINTESI (Elenco NRE) ---
  // Una sintesi contiene solo NRE + date + un CF (anche parziale): NESSUN
  // medico né esenzione. Se mancano le label del medico e ci sono NRE,
  // il documento è una sintesi, non una ricetta.
  const hasMedicoLabel = LABELS.CF_MEDICO.test(text) || LABELS.MEDICO_NOME.test(text);
  if ((hasElencoNre || (!hasMedicoLabel && !hasPromemoriaHeader)) && !hasRicettaLabels && nres.length > 0) {
    const cf = pickUniqueAssistitoCF(text, null);
    if (!cf || nres.length === 0) return null;
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

  // --- RICETTA / PROMEMORIA ---
  if (hasRicettaLabels || hasPromemoriaHeader || hasSSNHeader) {
    const cfMedico = parseCfMedico(text);
    const medico = sanitizeMedico(parseField(text, "MEDICO_NOME"));
    const esenzione = parseEsenzione(text);
    const dataRicetta = parseData(text);
    const resolved = resolveAssistitoByCF(text, cfMedico);

    // Senza CF assistito coerente con un nome → lasciamo all'AI per retry.
    if (!resolved) return null;
    // Ricetta senza NRE estraibile dal layer di testo: capita su PDF "ibridi"
    // dove il NRE è solo nel barcode/immagine. Cediamo all'AI vision invece
    // di salvare una ricetta vuota che verrebbe scartata silenziosamente.
    if (nres.length === 0) return null;
    const { nome, cognome, cf } = resolved;

    return {
      tipo_documento: "ricetta",
      has_barcode_code39: true,
      keyword_prescrizione_trovata: true,
      codice_fiscale: cf,
      nome,
      cognome,
      medico: medico || null,
      esenzione,
      data_ricetta: dataRicetta,
      dpc: /\bDPC\b/i.test(text),
      prescrizioni: nres.map((n) => ({ numero_ricetta: n.full, codice_regionale: n.reg })),
      confidence: medico && cognome && nome && nres.length > 0 ? "high" : "low",
    };
  }

  return null;
}

// ---------- helpers: label-to-label window ----------

/**
 * Etichette note che fanno da delimitatori. La chiave è il "tipo" logico,
 * il valore è il pattern regex (case-insensitive) che identifica l'INIZIO
 * dell'etichetta nel testo.
 */
const LABELS: Record<string, RegExp> = {
  // Varianti viste sul campo:
  //  - "COGNOME E NOME/INIZIALI DELL'ASSISTITO:"
  //  - "COGNOME E NOME/ INIZIALI DELL'ASSISTITO:"
  //  - "COGNOME E NOME:" (promemoria semplificato — escludi "DEL MEDICO")
  ASSISTITO_NOME: /COGNOME\s+E\s+NOME(?!\s+DEL\s+MEDICO)(?:\/?\s*INIZIALI[^:]{0,40})?\s*:/i,
  INDIRIZZO: /\bINDIRIZZO\s*:/i,
  CAP: /\bCAP\s*:/i,
  CITTA: /\bCITT[A']?\s*:/i,
  PROV: /\bPROV\s*:/i,
  COMUNE: /\bCOMUNE\s*:/i,
  ESENZIONE: /\bESENZIONE\s*:/i,
  SIGLA_PROVINCIA: /\bSIGLA\s+PROVINCIA\s*:/i,
  CODICE_ASL: /\bCODICE\s+ASL\s*:/i,
  DISPOSIZIONI_REGIONALI: /\bDISPOSIZIONI\s+REGIONALI\s*:/i,
  TIPOLOGIA_PRESCRIZIONE: /\bTIPOLOGIA\s+PRESCRIZIONE/i,
  ALTRO: /\bALTRO\s*:/i,
  PRIORITA_PRESCRIZIONE: /\bPRIORITA[']?\s+PRESCRIZIONE/i,
  PRESCRIZIONE: /\bPRESCRIZIONE\b/i,
  QUESITO_DIAGNOSTICO: /\bQUESITO\s+DIAGNOSTICO\s*:/i,
  N_CONFEZIONI: /\bN[\.\s]*CONFEZIONI/i,
  TIPO_RICETTA: /\bTIPO\s+RICETTA\s*:/i,
  DATA: /\bDATA\s*:/i,
  // Varianti: "CODICE FISCALE DEL MEDICO:" / "CODICE FISCALE MEDICO:"
  CF_MEDICO: /\bCODICE\s+FISCALE\s+(?:DEL\s+)?MEDICO\s*:/i,
  // Nei promemoria capita "BUSCARINO LUIGICODICE AUTENTICAZIONE:" (no spazio
  // prima di CODICE), quindi non usiamo \b iniziale.
  CODICE_AUTENTICAZIONE: /CODICE\s+AUTENTICAZIONE\s*:/i,
  MEDICO_NOME: /\bCOGNOME\s+E\s+NOME\s+DEL\s+MEDICO\s*:/i,
  RILASCIATO: /Rilasciato\s+ai\s+sensi/i,
};

/**
 * Ritorna il segmento di testo che segue la label data, fermandosi alla
 * prima occorrenza di qualsiasi altra label del set (label-window).
 */
function parseField(text: string, key: keyof typeof LABELS): string {
  const labelRe = LABELS[key];
  const m = labelRe.exec(text);
  if (!m) return "";
  const start = (m.index ?? 0) + m[0].length;
  const tail = text.slice(start);

  let stop = tail.length;
  for (const [otherKey, otherRe] of Object.entries(LABELS)) {
    if (otherKey === key) continue;
    // ricerca dall'inizio del tail
    const re = new RegExp(otherRe.source, "i");
    const om = re.exec(tail);
    if (om && (om.index ?? 0) < stop) stop = om.index ?? stop;
  }
  return tail.slice(0, stop).replace(/\s+/g, " ").trim();
}

// ---------- helpers: NRE / CF / campi ----------

// 5 char alfanumerici + 10 cifre, con eventuale spazio fra i due gruppi.
// Usiamo lookaround invece di \b per evitare match parziali tipo "900AC4963..."
// quando in input compare "1900AC 4963790679".
const NRE_RE = /(?<![A-Z0-9])([A-Z0-9]{5})\s*(\d{10})(?![A-Z0-9])/g;

function extractNREs(text: string): { full: string; reg: string }[] {
  // Rimuovi caratteri non alfanumerici (incluso Ì Î Ë * $ ' / ecc.) → spazio.
  let compact = text.toUpperCase().replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ");
  // Stacca il check-char Code39 in coda al NRE (es. "4963790679Y" → "4963790679 Y").
  compact = compact.replace(/(\d{10})([A-Z])(?![A-Z0-9])/g, "$1 $2");
  // Stacca anche il check-char NUMERICO in coda al NRE da barcode
  // (es. "49652912111" = NRE 4965291211 + check digit "1").
  compact = compact.replace(/(?<![0-9])(\d{10})(\d)(?![A-Z0-9])/g, "$1 $2");
  // Stacca il check-char in coda al codice regionale "1900AC" → "1900A C".
  compact = compact.replace(/(?<![A-Z0-9])(\d{4}[A-Z])([A-Z])(?![A-Z0-9])/g, "$1 $2");
  const out: { full: string; reg: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  NRE_RE.lastIndex = 0;
  while ((m = NRE_RE.exec(compact))) {
    const reg = m[1];
    const num = m[2];
    // Il codice regionale deve avere almeno una lettera (es. 1900A, 0301G)
    // per evitare di catturare CAP/numeri telefonici/CF interni.
    if (!/[A-Z]/.test(reg)) continue;
    // Il codice regionale "vero" è 4 cifre + 1 alfanumerico.
    if (!/^\d{4}[A-Z0-9]$/.test(reg)) continue;
    const full = reg + num;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ full, reg });
  }
  return out;
}

function parseCfMedico(text: string): string | null {
  const raw = parseField(text, "CF_MEDICO");
  if (!raw) return null;
  const m = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase().match(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/);
  return m ? normalizeCF(m[0]) : null;
}

function parseEsenzione(text: string): string | null {
  const raw = parseField(text, "ESENZIONE");
  if (!raw) return null;
  const v = raw.replace(/\s+/g, "").toUpperCase();
  if (!v || /^N(ON)?$/.test(v)) return null;
  const m = v.match(/^[A-Z0-9]{2,5}/);
  return m ? m[0] : null;
}

function parseData(text: string): string | null {
  const m = text.match(/\bDATA\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Tutti i CF (16 char) presenti nel testo, esclusi quelli passati in exclude.
 */
function allCFs(text: string, exclude: string[] = []): string[] {
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const candidates = cleaned.match(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const n = normalizeCF(c);
    if (!n) continue;
    if (exclude.includes(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Per la sintesi (Elenco NRE) c'è un solo CF nel documento (l'assistito).
 * Scarta eventuali CF medico se passato.
 */
function pickUniqueAssistitoCF(text: string, cfMedico: string | null): string | null {
  const cfs = allCFs(text, cfMedico ? [cfMedico] : []);
  if (cfs.length === 0) return null;
  // se più di uno, prendiamo il primo (è quello in testa al documento)
  return cfs[0];
}

/**
 * Risolve l'assistito usando il CF come fonte di verità.
 * 1. Estrae tutti i CF candidati (esclude CF medico).
 * 2. Legge l'etichetta ASSISTITO_NOME (label-window) per ottenere i token.
 * 3. Prova tutte le partizioni cognome/nome e l'ordine invertito.
 * 4. La combinazione (CF, partizione) coerente con cfPrefixFromName vince.
 */
function resolveAssistitoByCF(
  text: string,
  cfMedico: string | null,
): { nome: string; cognome: string; cf: string } | null {
  const cfCandidates = allCFs(text, cfMedico ? [cfMedico] : []);
  if (cfCandidates.length === 0) return null;

  // Toglie dal valore della label assistito eventuali CF (in chiaro o
  // delimitati da Ì…Î / *…* ) prima di tokenizzare, così tokens non
  // contiene pezzi del codice fiscale come "ÌLMBLNE".
  let nameRaw = parseField(text, "ASSISTITO_NOME");
  for (const c of cfCandidates) {
    // Stripa anche un eventuale check-char attaccato a fine CF (es. "M9Î").
    nameRaw = nameRaw.replace(new RegExp(`[^A-Z0-9]?${c}[A-Z0-9]?`, "gi"), " ");
  }
  const tokens = nameRaw
    .toUpperCase()
    .replace(/[^A-Z' \-]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  if (tokens.length === 0) {
    // Nessun nome leggibile ma CF unico → comunque richiede nome per la regola.
    return null;
  }

  // Genera partizioni plausibili cognome/nome (e ordine invertito).
  const partitions: { cognome: string; nome: string }[] = [];
  if (tokens.length === 1) {
    partitions.push({ cognome: tokens[0], nome: "" });
  } else {
    for (let k = 1; k < tokens.length; k++) {
      partitions.push({
        cognome: tokens.slice(0, k).join(" "),
        nome: tokens.slice(k).join(" "),
      });
      partitions.push({
        cognome: tokens.slice(k).join(" "),
        nome: tokens.slice(0, k).join(" "),
      });
    }
  }

  for (const cf of cfCandidates) {
    const prefix = cf.slice(0, 6);
    for (const p of partitions) {
      if (!p.nome || !p.cognome) continue;
      if (cfPrefixFromName(p.cognome, p.nome) === prefix) {
        return { nome: p.nome, cognome: p.cognome, cf };
      }
    }
  }

  return null;
}

/**
 * Ripulisce il nome medico estratto dalla label window. Casi visti:
 *  - "BUSCARINO LUIGICODICE AUTENTICAZIONE: 0806…"  → "BUSCARINO LUIGI"
 *  - "ORLANDO GIACOMO Rilasciato ai sensi …"        → "ORLANDO GIACOMO"
 * Strategia: tronca al primo marker noto (CODICE, RILASCIATO) anche se
 * incollato senza spazio, e rimuove qualsiasi sequenza di 5+ cifre.
 */
function sanitizeMedico(raw: string): string {
  if (!raw) return "";
  let v = raw;
  v = v.replace(/CODICE\s*AUTENTICAZIONE[\s\S]*$/i, "");
  v = v.replace(/Rilasciato\s+ai\s+sensi[\s\S]*$/i, "");
  v = v.replace(/\d{5,}/g, " ");
  v = v.replace(/[^A-ZÀ-Ÿ' \-]/gi, " ");
  return v.replace(/\s+/g, " ").trim().toUpperCase();
}

// Riesporta utilità CF per chi importa solo questo modulo (test, ecc.)
export { normalizeCF, cfMatchesName };