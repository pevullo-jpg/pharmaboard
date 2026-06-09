
# Estrazione ricette: deterministica, zero AI

## Risposta breve
Sì. Quasi tutti i documenti che processiamo (promemoria DEM, ricette cartacee SSN, fogli di sintesi NRE) sono **PDF con layer di testo nativo**, non scansioni. Su questi il parsing regex+layout è più accurato e più economico dell'AI vision. L'AI resta solo come **fallback** per i casi in cui il PDF non ha testo (scansioni pure) o per le immagini JPG/PNG.

## Strategia a 2 livelli

```text
PDF/IMG ricevuto
   │
   ├─ è PDF con testo estraibile? ── NO ─► fallback AI vision (come oggi)
   │           │
   │           SÌ
   │           ▼
   └─► parser deterministico:
        1. estrai testo + posizioni con `unpdf` o `pdfjs-dist`
        2. classifica documento (ricetta / sintesi / altro) via pattern
        3. estrai CF, nome, cognome, medico, NRE, regionale, esenzione, data via regex ancorate alle label SSN ("COGNOME E NOME", "CODICE FISCALE DEL MEDICO", "CODICE AUTENTICAZIONE", ecc.)
        4. valida (checksum CF, formato NRE 5 alfanumerici + 10 cifre)
```

## Cosa cambia tecnicamente

### Nuovo file: `src/lib/ricette-parser.server.ts`
- `parsePdfRicetta(bytes: Uint8Array): Promise<ExtractedDoc | null>`
- Usa `unpdf` (già edge-compatible, niente binari nativi → ok su Cloudflare Worker).
- Estrae stringa testuale completa del PDF.
- Se `text.length < 50` → ritorna `null` (PDF immagine, va all'AI).
- Altrimenti applica i classificatori in ordine.

### Classificatori (pattern-based)
**Promemoria DEM** (es. `Promemoria_1900A4963790679_…pdf`):
- header `RICETTA ELETTRONICA-PROMEMORIA PER L'ASSISTITO`
- NRE nel filename + ripetuto nel body
- estrai: `Sicilia 1900A 4963790679` → NRE/regionale; `COGNOME E NOME…ASSISTITO:` → nome; CF assistito 16 char vicino all'indirizzo; `COGNOME E NOME DEL MEDICO:` → medico; `CODICE FISCALE DEL MEDICO:` → CF medico (scartato); `CODICE AUTENTICAZIONE:` → progressivo; `DATA:` → data; `ESENZIONE:`.

**Ricetta SSN cartacea** (es. `1900A4964766295.pdf`):
- header `SERVIZIO SANITARIO NAZIONALE` + `REGIONE …` + barcode-text `*1900A* *4964766295*`
- stessa griglia di label, ma CF assistito può mancare → ricetta resta orfana.

**Foglio di sintesi NRE** (es. `Elenco_NRE.pdf`):
- presenza ripetuta di label `NRE` e `PIN-NRBE`, **assenza** di blocco PRESCRIZIONE/QTA/farmaco
- 1 CF assistito + lista di NRE → tipo `sintesi`.

**Altro**: nessun pattern combacia → eliminato.

### Regex ancorate alle label (anti-rumore)
Tutte case-insensitive, multilinea:
- CF (16 char): `/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/` + verifica checksum (già in `gmail.functions.ts`).
- NRE: `/\b([A-Z0-9]{5})[ \t]*(\d{10})\b/` (regionale + numerico, con spazio opzionale come in `1900A 4963790679`).
- Nome assistito: cattura dopo `COGNOME E NOME[^:]*ASSISTITO:` fino a fine riga.
- Medico: dopo `COGNOME E NOME DEL MEDICO:`.
- Esenzione: dopo `ESENZIONE:` fino a `SIGLA PROVINCIA` o newline.
- Data: dopo `DATA:` formato `dd/mm/yyyy` → ISO.

### Validazione (stessa di oggi)
- CF: checksum + prime 6 lettere coerenti con cognome+nome → se KO, è il CF del medico, scartalo.
- NRE: `[A-Z0-9]{5}\d{10}` (15 char).
- Ricetta canonica: nome+cognome+medico+NRE+almeno una occorrenza di "prescrizione" nel testo.

### Modifiche a `src/lib/gmail.functions.ts`
- Nuovo flusso in `runHubSync` e `reprocessExistingRicette`:
  1. download allegato → bytes.
  2. se PDF: `parsePdfRicetta(bytes)`.
  3. se ritorna `null` o classifica `ambiguous` → fallback su `extractDocumentWithAI` (codice attuale).
  4. immagini JPG/PNG: vanno direttamente all'AI vision (nessun cambiamento).
- `extractDocumentWithAI` resta come fallback; non viene rimosso.

### Telemetria
Contatori distinti in output di sync/reprocess:
- `parsed_deterministic`, `parsed_ai_fallback`, `parsed_image_ai`, `failed`.

## Dipendenza
- Aggiungere `unpdf` (pure-JS, ESM, runtime Worker-compatibile, ~200 KB). Niente `pdf-parse` (Node-only, usa `fs`).
- `pdf-lib` già presente: si tiene per il merge.

## Risparmio atteso
- Su promemoria DEM e ricette cartacee con layer testo (la grande maggioranza): **0 chiamate AI**.
- AI solo per: immagini, PDF scansionati, PDF dove il parser non trova abbastanza segnali.
- Riduzione chiamate AI stimata: 80–95% del traffico attuale.
- Latenza per documento: da ~3–8 s (vision) a ~50–200 ms (regex su testo).

## Limiti onesti
- I PDF promemoria sono standardizzati a livello nazionale, quindi il parser è affidabile. Le ricette cartacee SSN regionali hanno piccole varianti di layout: il parser si basa sulle **label di testo** (stabili in tutta Italia per regolamento DM 2/11/2011), non sulle coordinate, quindi tollera differenze grafiche.
- Documenti rari/non standard cadono nel fallback AI. Nessuna ricetta viene mai persa "silenziosamente".

## Cosa NON cambia
- Schema DB, UI, logica di dedup per NRE, gestione orfani, validazione CF.
- L'AI fallback resta identico → comportamento sui casi limite invariato.

## Conferme prima di partire
1. Procedo direttamente con `unpdf` o preferisci `pdfjs-dist` (più pesante ma standard)?
2. Sui PDF deterministici, se il parser estrae con successo NRE+nome+medico ma manca CF assistito → salvo come orfano (come da regola attuale)?
