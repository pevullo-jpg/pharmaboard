## Diagnosi (da DB reale)

**Lombardo Eliana — "due copie della stessa ricetta"**
Dalla query DB risulta che la stessa email (`19ea6c6f6e0089f7`) ha generato 3 righe:
- `4963790679` (10 cifre, parser AI vecchio)
- `4963790706` (10 cifre, parser AI vecchio)
- `1900A4963790679` (15 char, parser deterministico nuovo — è la sintesi)

Lo stesso NRE viene memorizzato in due formati diversi (10 cifre vs `codice_regionale + 10 cifre`), quindi il dedup `eq("numero_ricetta", ...)` non li riconosce come duplicati. La sintesi inserisce `1900A4963790679` mentre la ricetta full aveva `4963790679`: sembrano "due copie" perché stessa persona, stessa data, stesso farmaco visivo, ma chiave diversa.

Stesso pattern su TODARO (`4964740622` vs `1900A4964740622`).

**Assistito non collegato sulla riga "sintesi"**
La riga sintesi di TODARO (`b08d2363`) ha `assistito_id = NULL` anche se l'assistito esiste già (creato 15s prima dalla ricetta full). Il bug è nel parser sintesi: ritorna `nome: null, cognome: null`, quindi `resolveOrCreateAssistito` con cf valido dovrebbe trovare la riga via `byCf`. Va indagato perché non aggancia (probabile race / log da aggiungere).

**Assistiti "non creati"**
In realtà gli assistiti vengono creati (33 in DB, l'ultimo oggi alle 07:33). Sospetto che il problema sia che per le ricette nuove di oggi gli assistiti non vengono aggiunti, oppure è un fraintendimento con il punto sopra (sintesi orfana fa sembrare la ricetta "non associata"). → vedi domanda 1.

**Flag non mostrati**
I badge `DebitiBadge / AnticipiBadge / PrenotazioniBadge` fanno una `useQuery` per ogni riga assistito, non leggono dai dati embedded della query `assistiti`. Possibile causa: 1) RLS che blocca la SELECT su anticipi/prenotazioni/debiti per la sessione, 2) il `farmacia_id` non è popolato sulle righe figlie, 3) il dato embedded `anticipi/debiti/prenotazioni` non viene mai usato. → vedi domanda 2.

## Modifiche

### 1) Canonicalizzazione NRE (fix duplicato Lombardo)
In `src/lib/gmail.functions.ts`:
- Helper `canonicalNre(numero, regionale)`: se `numero` è 10 cifre e `regionale` è 5 char alfanumerici, ritorna `regionale + numero`. Se `numero` è già 15 char, ritorna così.
- Applicato in `runHubSync` e `reprocessExistingRicette` prima dell'insert/update e prima della dedup.
- Backfill via SQL: per le ricette con `numero_ricetta` di 10 cifre e `codice_regionale` di 5 char, aggiornare a `regionale || numero`. Poi rimuovere duplicati esatti su `(farmacia_id, numero_ricetta)` tenendo la più vecchia (con assistito_id valido).

### 2) Riallineo sintesi orfane (TODARO case)
In `runHubSync`, dopo l'insert della prescrizione, se `assistitoId` è null e `cfValid` esiste, ritenta un lookup pulito (in caso di race) prima di salvare. Inoltre, dopo aver processato tutte le prescrizioni di un'email, fare un UPDATE finale: `ricette set assistito_id = (select id from assistiti where cf = ... and farmacia_id = ...) where assistito_id is null`.

### 3) Logging diagnostico assistiti
Aggiungere `console.log` in `resolveOrCreateAssistito` per ogni path (`byCf hit`, `created`, `skipped no-name`) così possiamo capire la prossima regressione dai logs server.

### 4) Flag badges
Da chiarire (vedi domande).

## Domande prima di implementare

1. **Assistiti "non creati"**: per quale ricetta specifica ti aspettavi un nuovo assistito e non è apparso? Mi dai un nome/CF o lo screenshot della dashboard ricette → la creo nel debug.
2. **Flag**: quali flag intendi? (a) i badge €/anticipi/prenotazioni colorati sulla riga assistito, (b) un flag DPC sulle ricette, (c) altro? Se è (a), i dati embedded (`debiti/anticipi/prenotazioni`) sono già nella query principale ma i badge fanno il loro fetch separato — vuoi che usi solo i dati embedded (più veloce, meno query) o lasciamo il fetch per riga?
