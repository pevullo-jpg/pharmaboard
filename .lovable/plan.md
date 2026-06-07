
# Sincronizzazione Gmail per farmacia (OAuth per-utente)

Ogni farmacia collega la propria casella Gmail con un click. L'app legge solo i messaggi pertinenti (ricette), li importa nella tabella `ricette` e li isola per `farmacia_id`. Niente password salvate, niente forwarding, niente verifica Google a carico tuo.

## Architettura

```text
Farmacia → click "Collega Gmail" → popup Google OAuth (broker Lovable)
                                        ↓
                              connectionId Google salvato su farmacie.gmail_connection_id
                                        ↓
        Cron ogni 5 min  →  server fn "sync" per ogni farmacia attiva
                                        ↓
        Gmail API (gateway) con filtro Gmail search query
                                        ↓
        Parsing oggetto + allegato PDF  →  insert in ricette (farmacia_id)
```

## Componenti

### 1. OAuth per-utente (App User Connector Google)
- Helper server `src/integrations/lovable/appUserConnector.ts` + client `appUserConnectorClient.ts` (popup, iframe-safe per preview Lovable)
- Server fn `startGmailConnect` → richiede `authorizationUrl` con scope `gmail.readonly` + `gmail.modify` (per marcare come letto)
- Server fn `saveGmailConnection({ connectionId })` → scrive `gmail_connection_id` su `farmacie` della farmacia corrente (RLS scoped)
- Server fn `disconnectGmail` → azzera la colonna

### 2. UI lato farmacia — `/_authenticated/impostazioni/gmail`
- Stato connessione: "Non collegato" / "Collegato come `farmacia@xxx.it`"
- Bottone "Collega Gmail" (popup) / "Scollega"
- Sezione **Filtri ricette** modificabili:
  - Keyword oggetto (default: `ricetta`, `NRE`, `prescrizione`, `promemoria`, `dematerializzata`)
  - Mittenti whitelist (domini medici, PEC note)
  - Solo email con allegato PDF (toggle)
  - Etichetta Gmail opzionale (es. solo da label "Ricette")
- Mostra ultime 10 email importate + ultime 5 scartate (debug filtro)
- Pulsante "Sincronizza ora"

### 3. Filtro selettivo lato Gmail API
La query Gmail si costruisce server-side dai filtri della farmacia. Esempio:
```
(subject:(ricetta OR NRE OR prescrizione OR promemoria) OR has:attachment filename:pdf)
  AND newer_than:7d
  AND -in:spam -in:trash
```
Possibilità di restringere a `label:Ricette` se la farmacia ha già un'etichetta dedicata.

### 4. Sync server function
- `syncGmailFarmacia(farmaciaId)` (admin, chiamata da cron):
  1. Legge `gmail_connection_id` + filtri da DB
  2. `gmail.users.messages.list` con la query
  3. Per ogni messaggio nuovo (id non già in `ricette.source_email_id`):
     - `messages.get?format=full`
     - Estrae mittente, oggetto, data, allegati
     - Se ha PDF → upload su storage `ricette-pdf/{farmacia_id}/{messageId}.pdf`
     - Tenta parsing campi base dall'oggetto/corpo (NRE, CF) con regex
     - Insert in `ricette` con `farmacia_id`, `source='gmail'`, `source_email_id`, `pdf_url`, `stato='nuova'`
     - Opzionale: marca email come letta (richiede scope `gmail.modify`)
- `syncAllFarmacie()` itera su tutte le farmacie attive con Gmail collegato

### 5. Cron schedulato
- Route server pubblica `/api/public/cron/sync-gmail` protetta con `CRON_SECRET` (Bearer header)
- pg_cron schedulato ogni 5 minuti chiama l'URL pubblico stabile
- Logga successi/errori in nuova tabella `gmail_sync_log` (farmacia_id, started_at, finished_at, imported, errors, error_message)

### 6. Tabella nuova: `gmail_sync_log`
Per audit e UI di stato sync per farmacia.

### 7. Storage bucket nuovo: `ricette-pdf` (privato)
RLS: solo membri della farmacia possono leggere i PDF della propria farmacia.

## Schema DB (migrazione)

- Aggiunge a `farmacie`:
  - `gmail_email` (text) — email effettiva collegata, per UI
  - `gmail_sync_filters` (jsonb) — keyword, mittenti, label, has_attachment_pdf
  - `gmail_last_sync_at` (timestamptz)
  - `gmail_sync_enabled` (boolean default true)
  - (`gmail_connection_id` esiste già)
- Crea `gmail_sync_log`
- Crea bucket storage `ricette-pdf` con RLS per farmacia

## Secrets richiesti

- `GOOGLE_APP_USER_CONNECTOR_CLIENT_ID` — fornito da Lovable (connector google app-user)
- `CRON_SECRET` — random string per proteggere l'endpoint cron

## Limiti / note di trasparenza

- **Quota Gmail API**: 1 miliardo di unità/giorno per progetto Google, ~250 unità/sync per messaggio. Per 100 farmacie con 50 ricette/giorno = ~1.25M unità/giorno. Margine ampio.
- **Verifica Google**: il broker Lovable usa la propria app Google già verificata, quindi le farmacie vedono la schermata di consenso "Lovable" — non devi fare verifica tu. Se in futuro volessi branding tuo, serve verifica Google separata (~3-6 settimane).
- **Scope sensibili**: `gmail.readonly` è sensitive ma supportato. Se aggiungiamo `gmail.modify` per marcare letto, lo scope è restricted — già coperto dal connector Lovable.
- **Latenza**: 5 min di ritardo medio sulle nuove ricette. Riducibile a 1 min se serve.
- **Storage PDF**: ~500KB/ricetta. 100 farmacie × 50/giorno × 30gg = ~75GB/mese. Va monitorato; eventuale retention 90 giorni con cleanup.

## Cosa NON fa questo piano

- Non invia email (solo lettura)
- Non gestisce PEC (richiede IMAP separato — fase successiva)
- Non gestisce Outlook/M365 (richiede secondo connector Microsoft — fase successiva)
- Non fa OCR del PDF ricetta (parsing solo da oggetto/corpo email; OCR è step opzionale successivo)

## Ordine implementazione

1. Migrazione DB (colonne farmacie + tabella log + bucket storage)
2. Helper OAuth app-user + collegamento connector Google
3. Pagina `/impostazioni/gmail` con popup di connessione
4. Server fn sync + parsing email
5. Route cron + schedulazione pg_cron
6. UI log sync e filtri editabili

## Domande prima di partire

1. **Scope Gmail**: solo lettura (`gmail.readonly`) o anche marcatura come letto/etichetta "Importata" (`gmail.modify`)? Consiglio modify, è utile.
2. **Frequenza sync**: 5 minuti va bene o serve quasi-realtime (Gmail push notifications via Pub/Sub, più complesso)?
3. **Storage PDF**: salviamo i PDF su Storage Lovable o teniamo solo il riferimento Gmail (`source_email_id`) e riscarichiamo on-demand quando l'operatore apre la ricetta? Il secondo risparmia storage ma richiede Gmail sempre collegato.
4. **Retention**: dopo quanto tempo cancelliamo le email/PDF già processati? 30/90/mai?
