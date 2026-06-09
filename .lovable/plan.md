# Piano: miglioramento riconoscimento ricette

## Diagnosi (dai sample allegati)

Ho testato il parser attuale sui PDF forniti. Cosa emerge:

1. **`unpdf` restituisce TUTTO il testo su una singola riga** (nessun `\n`, gli spazi fra colonne diventano singolo spazio). Il parser oggi si basa su `takeLineAfter` con stop su `\n` o su `\s{2,}LABEL:` → quindi cattura testo "a valanga".
   - Esempio reale (`1900A4964766295.pdf`):
     - cognome estratto: `SPITALI` ✓
     - nome estratto: `CALOGERA INDIRIZZO VIA ROMITA CAP CITTA' GROTTE ... ESCITALOPRAM OSSALATO ---` ✗
     - medico estratto: `BUSCARINO LUIGICODICE AUTENTICAZIONE ... METOTREXATO SODICO ---` ✗
2. Per i Promemoria (`Ì1900ADÎ1900A`, `ÌLMBLNE…ÎLMBLNE…`) il testo "barcode + pulito" è incollato. Le ancore funzionano ma il name resolver fallisce perché `resolveAssistitoByCF` testa tutti i token raccolti dal blocco contaminato e non trova match → ritorna `null` → la ricetta viene scartata.
3. Risultato sui 11 PDF di prova:
   - 2 estratti come ricetta con `cognome` corretto ma `nome`/`medico` sbagliati → comunque salvabili solo perché `cfMatchesName` controlla solo i primi 6 caratteri del CF → matcha sul cognome+primo nome.
   - 7 ricette `null` → scartate del tutto.
   - 1 sintesi (`Elenco_NRE`) estratta con solo 1 NRE su 2.
4. Pre-filtro keyword in `runHubSync` (`isEmailRelevantForRicetta`) salta intere mail se subject/snippet/filename non contengono "prescriz|ricett|nre|promemoria|dem|ssn|dpc". Da rimuovere.
5. Il loop attuale itera già su tutti gli allegati PDF/immagine (`collectAttachmentParts` ricorsivo) — OK. Da rinforzare: processare ogni PDF anche se uno fallisce, e includere i PDF *nested* dentro `multipart/related` o `message/rfc822` (forwarded).

## Cambi proposti

### 1. `src/lib/gmail.functions.ts`

- **Rimuovere** `RICETTA_KEYWORDS` e la chiamata `isEmailRelevantForRicetta` in `runHubSync`. Tutti gli allegati PDF/immagine vengono scaricati e dati al parser.
- **Estendere `collectAttachmentParts`** per scendere anche in `message/rfc822` e ignorare gli allegati con mime non PDF/immagine (firma S/MIME `application/pkcs7-signature`, `application/octet-stream` solo se filename `.pdf`).
- **Continuare il loop** sugli allegati anche dopo una `extractDocumentFromAttachment` che fallisce: oggi un `skipped++; continue;` va bene, ma loggiamo il motivo (parser/AI fallback / scartato per validazione).
- **`runHubSync` log finali**: aggiungere counters `extractedDeterministic / extractedAi / rejectedNoCf / rejectedNameMismatch` per diagnosticare.

### 2. `src/lib/ricette-parser.server.ts` — riscrittura ancorata a label

Approccio: invece di "prendi la riga dopo la label", usiamo **estrazione fra label note** (label-to-label window) con elenco esaustivo delle etichette SSN che troviamo nei sample. Tutte le label sono delimitatori globali; il valore di `LABEL_X` è il testo fra `LABEL_X:` e la prossima label che compare nel testo.

Label set (ordine non rilevante):
```
COGNOME E NOME ASSISTITO        (varianti: /COGNOME E NOME(?:\/INIZIALI)?(?:\s+DELL['']?)?\s*ASSISTITO\s*:/i)
INDIRIZZO:
CAP:
CITTA':
PROV:
ESENZIONE:
SIGLA PROVINCIA:
CODICE ASL:
DISPOSIZIONI REGIONALI:
TIPOLOGIA PRESCRIZIONE
ALTRO:
PRIORITA' PRESCRIZIONE
PRESCRIZIONE
QTA
NOTA
QUESITO DIAGNOSTICO:
N.CONFEZIONI / PRESTAZIONI
TIPO RICETTA:
DATA:
CODICE FISCALE DEL MEDICO:
CODICE AUTENTICAZIONE:
COGNOME E NOME DEL MEDICO:
Rilasciato ai sensi
```

Algoritmo `parseField(text, label, allLabels)`:
1. Trova `match = labelRegex.exec(text)`.
2. Da `match.index + match[0].length`, scansiona in avanti finché non trova l'inizio della prossima label (qualunque label del set, non solo successiva in ordine documento).
3. Ritorna il segmento ripulito (`.replace(/\s+/g," ").trim()`).

Vantaggi: funziona sia su testo monoriga (unpdf) sia su layout pdftotext, sia su Promemoria che su SSN cartacea.

Estrazioni specifiche:
- **Cognome+Nome assistito**: parsa il valore di `COGNOME E NOME ASSISTITO`, normalizza spazi, tokenizza A-Z. Combina con il CF assistito (`resolveAssistitoByCF`) per scegliere la partizione corretta. Il CF è la fonte di verità.
- **CF assistito**:
  - Cerca tutti i pattern `[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]` in `text.replace(/[^A-Z0-9]/g,'')` (così include i CF circondati da `Ì…Î`).
  - Esclude il CF medico (estratto dalla label `CODICE FISCALE DEL MEDICO:`).
  - Sceglie il CF coerente con cognome+nome dell'header label. Se label assente o non match, **lascia fallback AI** (no salvataggio silenzioso con dati sbagliati).
- **Medico**: parsa `COGNOME E NOME DEL MEDICO`. Stop hard sulla parola `CODICE AUTENTICAZIONE` o sulla parola `Rilasciato`.
  - Bug attuale: nel sample `BUSCARINO LUIGICODICE AUTENTICAZIONE…` la label medico viene PRIMA di `CODICE AUTENTICAZIONE` quindi va aggiunta `CODICE AUTENTICAZIONE:` come delimitatore.
- **NRE**:
  - Pulisci `text` con `replace(/[^A-Z0-9]/g, ' ')` (rimuove `Ì Î Ë * $ y z` ecc.).
  - Regex `(?<![A-Z0-9])([A-Z0-9]{5})\s+(\d{10})(?![A-Z0-9])` con lookaround invece di `\b` per evitare match sporchi tipo `900AC + 4963790679` quando in input c'è `1900AC`. Codice regionale validato come `\d{4}[A-Z0-9]` (es. `1900A`, `0301G`).
  - Dedup case-insensitive sul `full = reg+num`.
  - Pre-filtra: scarta NRE che combaciano col CF assistito o col CF medico (15 cifre interne).
- **Sintesi** (`Elenco_NRE.pdf`): pattern `PIN-NRBE` o tabella `Data NRE PIN-NRBE`. Tutti gli NRE trovati sono prescrizioni. CF unico nel documento = CF assistito.
- **Esenzione**: subito dopo `ESENZIONE:` fino allo spazio o alla prossima label.
- **Data**: regex `DATA[^0-9]*?(\d{2}/\d{2}/\d{4})` → ISO.
- **DPC**: boolean su parola `DPC`.

### 3. Validazione e fallback

- `parsePdfRicetta` ritorna `null` SOLO quando il PDF non ha testo (scansione pura) o quando il testo non contiene NESSUN marker SSN noto. Altrimenti ritorna l'`ExtractedDoc` con confidence:
  - `high`: CF + nome coerente + medico + ≥1 NRE → salvato direttamente.
  - `low`: manca uno dei requisiti → caller decide se fare fallback AI.
- In `extractDocumentFromAttachment` (gmail.functions.ts): se parser ritorna `null` OR `confidence === "low"` → fallback `extractDocumentWithAI`.
- Regola "no CF assistito → no ricetta" mantenuta in `isValidRicettaCanonica`.

### 4. Verifica

Aggiungere uno script di test locale `scripts/test-parser.ts` (gitignored o no — TBD) che gira il parser su ogni PDF in `/mnt/user-uploads/` e stampa un report. Pre/post-cambio confronto:
- Oggi: 2/11 ricette estratte correttamente (cognome OK, nome/medico sporchi), 1/1 sintesi parziale.
- Atteso: 7/7 ricette + 2/2 promemoria + 1/1 sintesi con tutti i 2 NRE = 10/10 OK; 1 caso (`1900A4964779467` con CF `PRDVCN…`) verificato a parte.

## File toccati

- `src/lib/gmail.functions.ts` — rimuovi pre-filtro, estendi `collectAttachmentParts`, logging.
- `src/lib/ricette-parser.server.ts` — riscrittura con label-window.
- (opz.) `scripts/test-parser.ts` — harness di test.

## Domande

1. OK rimuovere completamente il pre-filtro keyword (ogni mail con PDF/immagine verrà analizzata, anche newsletter)? In alternativa lo posso allargare invece di rimuoverlo.
2. Quando il parser estrae NRE+nome ma il CF non combacia con il nome (ricetta cartacea con CF illeggibile o assente), **rifiuto totale** (regola attuale) oppure **salvo come orfano** in `orphan_ricette` per merge successivo?
