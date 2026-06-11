# Gmail personale per ogni farmacia (addio account hub)

## Obiettivo

Ogni farmacia collega la **propria casella Gmail** con un click (OAuth Google). L'app legge direttamente quella casella, applica le etichette **Valide / Scartate / Da verificare** secondo le regole deterministiche esistenti, e indicizza nel gestionale **solo le email etichettate Valide**. Il sistema attuale (account centrale + inoltro email + cron) viene rimosso del tutto.

## Come funzionerà per l'utente

1. **Impostazioni → "Collega casella Gmail"**: si apre un popup Google, il titolare autorizza l'accesso alla casella della farmacia (lettura + gestione etichette). L'app mostra l'indirizzo collegato e un pulsante "Scollega".
2. **Sincronizzazione**: avviene automaticamente all'apertura della dashboard (se l'ultima è più vecchia di qualche minuto) + pulsante "Sincronizza ora" per forzarla. Niente più cron in background.
3. **Nella casella Gmail** l'utente vedrà le sue email organizzate:
   - **Valide** → contenevano almeno una ricetta/sintesi conforme alle regole deterministiche (CF valido con checksum, NRE canonico, medico, keyword/barcode…) → importate nel gestionale
   - **Da verificare** → c'era un allegato pertinente ma mancava un requisito (es. CF assente o non valido) → NON importate
   - **Scartate** → nessun allegato utile o documento non pertinente → NON importate

## Dettagli tecnici

### 1. Connessione Gmail per-utente (App User Connector)

- Setup one-time del connettore Google in modalità "app user" (fornisce il client ID OAuth).
- Helper `appUserConnector.ts` (server-only) + `appUserConnectorClient.ts` (popup lato browser) già previsti dalla piattaforma.
- Scope richiesti: `gmail.readonly`, `gmail.modify`, `gmail.labels`.
- La chiave di connessione (`lovack_*`) viene salvata **solo lato server** in nuove colonne su `farmacie`: `gmail_connection_key`, `gmail_email`, `gmail_connected_at`, `gmail_last_sync_at`. Mai esposta al client (le query dal browser non la leggono: nuova policy/colonne escluse dalle select client e accesso solo via service role).

### 2. Nuova sync `syncFarmaciaGmail` (server fn, sostituisce `runHubSync`)

- Autenticata (`requireSupabaseAuth`) → risolve la farmacia dell'utente → carica la connection key via service role.
- Crea (se mancanti) le 3 etichette nella casella e ne memorizza gli ID.
- Query Gmail: `has:attachment newer_than:30d -label:Valide -label:Scartate -label:"Da verificare"` → niente più dipendenza da "non letto" e niente routing per mittente: tutto ciò che è in casella appartiene alla farmacia.
- Per ogni email: stesso pipeline deterministico attuale (estrazione allegati, parser ricette/sintesi, validazione CF/NRE, dedup per NRE, creazione assistiti con lookup cross-farmacia).
- Esito per email:
  - ≥1 ricetta/sintesi importata → etichetta **Valide**
  - allegato pertinente ma requisiti mancanti → **Da verificare**
  - nessun allegato utile / documento "altro" → **Scartate**
- Solo le email Valide producono righe in `ricette` (come oggi).

### 3. UI

- **Impostazioni**: card "Casella Gmail" con stato connessione, email collegata, pulsanti Collega/Scollega (solo titolare).
- **Dashboard**: sync automatica all'apertura (se ultima sync > 5 min) + pulsante "Sincronizza" con riepilogo (analizzate / valide / scartate / da verificare). Banner se il Gmail non è ancora collegato.

### 4. Smantellamento sistema hub

- Rimozione del cron job pg_cron che chiama l'endpoint ogni 5 minuti.
- Eliminazione di: `src/routes/api/public/hooks/sync-inbound-hub.ts`, logica hub in `inboundHub.functions.ts`, pagina admin `admin.email-pending.tsx`, tabella `inbound_pending`.
- Rimozione dei riferimenti a `email_inoltro` dalla UI (registrazione/impostazioni); la colonna resta in DB ma non è più usata.

## File toccati

- `src/lib/gmail.functions.ts` (riscrittura sync per-farmacia + gestione etichette)
- `src/integrations/lovable/appUserConnector.ts` + `appUserConnectorClient.ts` (nuovi)
- `src/routes/_authenticated/impostazioni.tsx`, `index.tsx` (UI connessione + sync)
- Migrazione DB: colonne Gmail su `farmacie`, drop `inbound_pending`
- Rimozione: route cron, pagina admin email pendenti, `inboundHub.functions.ts`

## Nota

Le regole deterministiche di validazione (CF con checksum, NRE canonico, barcode Code39, conteggio NRE nel badge, ecc.) restano identiche: cambia solo **da dove** si leggono le email e l'aggiunta delle etichette nella casella dell'utente.