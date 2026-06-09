# Riconoscimento ricette: regole stringenti + efficienza AI

## Obiettivi
1. Ridurre i consumi AI (oggi ogni documento fa 1–2 chiamate vision, anche su roba che non è ricetta).
2. Smettere di "saltare" ricette valide alzando il recall ma con criteri formali precisi.
3. Distinguere in modo netto: **ricetta canonica** vs **foglio di sintesi** vs **altro**.

## Definizioni concordate (da confermare ⚠️)

**Ricetta canonica** — TUTTI i seguenti elementi devono essere presenti:
- CF assistito (16 char, checksum valido, prime 6 lettere coerenti con cognome+nome);
- Nome **e** cognome assistito;
- Nome **e** cognome del medico prescrittore;
- La parola "prescrizione" (o varianti: "prescrizione medica", "promemoria di prescrizione");
- NRE numerico univoco;
- Codice regionale alfanumerico associato.

**Foglio di sintesi** — solo elementi sintetici:
- CF assistito (uno solo);
- Una o più coppie (codice regionale + NRE);
- Nessun dettaglio farmaco/medico.
- Accettato solo se **tutti** gli NRE non sono già presenti in ricette canoniche della stessa farmacia. Se anche uno solo è duplicato → scartato.

**Altro** — qualunque documento non rientri sopra (CI, tessera sanitaria, scontrini, referti, brochure, allegati firma, ecc.) → eliminato.

⚠️ Da chiarire prima dell'implementazione:
- **Lunghezza NRE**: oggi nel codice è 15 cifre (standard SSN nazionale); tu indichi 10 cifre. Confermi 10? Se sì, aggiorno tutta la regex `NRE_REGEX`.
- **Lunghezza codice regionale**: oggi accettiamo `≥6` alfanumerici; tu indichi 5 cifre. Accetto `5` esatte alfanumerico?

## Strategia di efficienza AI

Oggi ogni allegato fa: vision call Flash + (spesso) retry Pro. Costoso e lento. Nuovo flusso a 3 stadi:

### Stadio 1 — Filtro gratis sull'email
Prima di scaricare gli allegati controlliamo:
- subject + snippet + nome file allegato.
- Se non contiene almeno una keyword tra `prescrizione|ricetta|nre|promemoria|dem|SSN` → marca il messaggio come "non rilevante", non scarica allegati, non chiama AI. Salta direttamente.

Risparmio atteso: 30–50% delle email che oggi finiscono in AI per nulla.

### Stadio 2 — Pre-screening testuale dell'allegato (gratis)
Per ciascun allegato PDF:
- estrazione testo nativo con `pdf-lib` (no OCR, no AI) sul primo paio di pagine;
- regex check rapido: presenza di CF valido + parola "prescrizione" + pattern NRE.
- Tre esiti:
  - **chiaramente ricetta** (tutti i pattern presenti, CF coerente): salta direttamente all'estrazione AI mirata (Stadio 3a).
  - **chiaramente sintesi** (solo CF + lista NRE/regionali, niente farmaci/intestazione medico): salta a Stadio 3b.
  - **chiaramente altro** (nessun CF e nessun NRE in tutto il testo): elimina senza AI.
  - **ambiguo / PDF immagine senza testo estraibile**: → Stadio 3 vision.

Per le immagini (jpg/png) e PDF scansionati senza layer testo, si passa direttamente allo Stadio 3.

### Stadio 3 — Vision AI mirata, **una sola call**
- Modello unico: `google/gemini-2.5-flash` (basta nell'>95% dei casi).
- Retry su `gemini-2.5-pro` **solo se** l'output Flash è JSON malformato o `tipo_documento="altro"` con confidence bassa. Niente retry "preventivo".
- Prompt riscritto con i criteri formali esatti (vedi sotto): più corto, più deterministico, meno token in input.
- Prompt restituisce un campo `confidence` (low/medium/high) → guida l'eventuale retry.

### Stadio 4 — Validazione server (gratis)
Prima di salvare:
- Ricetta: deve avere CF valido + assistito (nome+cognome) + medico (nome+cognome) + NRE + parola "prescrizione" trovata nel raw_text. Se manca anche solo uno → declassa a "altro" → elimina.
- Sintesi: per ogni NRE, verifica dedup con query `select id from ricette where farmacia_id = ? and numero_ricetta = ?`. Anche **uno solo** già presente → scarta l'intero foglio (come da regola "se NRE presenti in altre ricette").
- Idempotenza: indice univoco `(farmacia_id, numero_ricetta)` su `ricette` per impedire duplicati anche in race condition.

## Modifiche tecniche

### File: `src/lib/gmail.functions.ts`
- Nuovo helper `isEmailRelevant(headers, snippet, filenames)` → boolean (Stadio 1).
- Nuovo helper `preScreenPdfText(bytes)` → `{ kind: "ricetta" | "sintesi" | "altro" | "ambiguous", cf, nres, regionali, hasPrescrizione }` usando `pdf-lib` + regex.
- `extractDocumentWithAI`: rimuove il retry preventivo Pro; ritorna anche `confidence`.
- Prompt riscritto:
  - elenco esplicito di "deve contenere": CF assistito, cognome+nome assistito, cognome+nome medico, parola "prescrizione", NRE (N cifre), codice regionale, barcode Code39;
  - regola sintesi: solo CF + (regionale+NRE), niente farmaci;
  - JSON include `confidence` e `keyword_prescrizione_trovata: boolean`.
- `NRE_REGEX` / `normalizeNRE` / `normalizeRegionale` aggiornati alle lunghezze confermate.
- `runHubSync` e `reprocessExistingRicette`: integrano gli stadi 1–4 nello stesso ordine e contano `skipped_by_filter`, `skipped_by_prescreen`, `ai_calls` per logging/debug.
- Validazione finale che richiede *anche* `medico` non vuoto e parola "prescrizione" nel testo grezzo (oggi non controllati).

### File: nuova migrazione SQL
- Indice univoco `ricette (farmacia_id, numero_ricetta)` (where `numero_ricetta is not null`).
- Niente nuove tabelle.

### Telemetria locale
- Log strutturato per ogni run: `processed`, `filtered_email`, `prescreened_altro`, `ai_calls`, `ai_retries`, `removed_altro`, `removed_dup`, `kept_ricette`, `kept_sintesi`. Mostrato nel toast di "Avvia rielaborazione".

## Cosa NON cambia
- Schema dati `ricette` e `assistiti` (solo campi già presenti, più l'indice).
- UI dashboard, card riassuntive, colori flag.
- Modello: continuiamo su Lovable AI (Gemini Flash). Niente provider esterni.

## Stima impatto
- Consumo AI: -50%/-70% (filtro email + prescreen testuale + niente retry preventivo).
- Recall ricette: +, perché il prescreen testuale intercetta anche PDF dove l'AI vision oggi sbaglia o salta.
- Falsi positivi "altro": ↓, grazie alla validazione obbligatoria su medico + parola "prescrizione".

## Domande prima di partire
1. Confermi NRE = **10 cifre** (non 15)?
2. Confermi codice regionale = **5 alfanumerici** esatti?
3. Sui fogli di sintesi: se *uno solo* degli NRE è già presente in archivio, scartiamo l'intero foglio o conserviamo solo gli NRE nuovi?
