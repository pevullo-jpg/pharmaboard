
# Hub Gmail centrale + forwarding selettivo (multi-tenant)

Una sola casella Gmail gestita da noi (`ilfarmacista.info@gmail.com`) fa da hub.
Ogni farmacia ha un alias univoco (`ilfarmacista.info+farmaciaXXXX@gmail.com`)
e configura un filtro nativo Gmail che inoltra automaticamente solo le email
con ricette verso il proprio alias. Un cron ogni 5 minuti legge l'hub via
Gmail API (connector Lovable), instrada ogni email alla farmacia corretta
leggendo l'alias dal `To:` e importa la ricetta nel tenant giusto.

## Architettura

```text
Casella farmacia (Gmail/Outlook)
   ↓ filtro nativo: "ricetta OR NRE OR prescrizione" + has_attachment
   ↓ azione: inoltra a ilfarmacista.info+farmaciaXXXX@gmail.com
Hub Gmail centrale (ilfarmacista.info@gmail.com)
   ↓ pg_cron ogni 5 min → POST /api/public/hooks/sync-inbound-hub
Gmail API (connector Lovable) list + get messages newer_than:30d
   ↓ per ogni messaggio: estrae alias dal To: → mappa su farmacia_id
   ↓ scarica allegato → AI parsing (Gemini multimodale)
   ↓ insert in ricette (farmacia_id corretto via supabaseAdmin)
Dashboard farmacia (RLS per farmacia_id)
```

## Componenti

### 1. Alias per-farmacia
- Colonna `farmacie.alias_inbound` (unique, NOT NULL).
- Trigger `set_farmacia_alias_inbound` BEFORE INSERT genera l'alias come `farmacia` + primi 8 hex dell'id.

### 2. Pagina UI `/impostazioni/inoltro-email`
- Mostra l'indirizzo `ilfarmacista.info+aliasXXXX@gmail.com` calcolato runtime da connector + alias farmacia.
- Pulsante copia.
- Guida passo-passo per Gmail (filtro nativo + inoltro).
- Server fn: `getInboundHubInfo` in `src/lib/inboundHub.functions.ts`.

### 3. Sync hub
- `runHubSync()` in `src/lib/gmail.functions.ts`: legge gli ultimi 50 messaggi `has:attachment newer_than:30d (ricetta OR prescrizione OR DPC)` dall'hub Gmail.
- Per ogni messaggio: estrae alias da `To/Cc/Delivered-To/X-Original-To`, mappa su `farmacia_id`, scarta i non-match, parsea allegato con AI, insert in `ricette` con `supabaseAdmin` (cross-tenant).
- `syncGmailRicette` (server fn) ora wrappa `runHubSync` (manuale, sempre da UI).

### 4. Cron
- Route pubblica `src/routes/api/public/hooks/sync-inbound-hub.ts` protetta dall'header `apikey` = anon key (SUPABASE_PUBLISHABLE_KEY).
- `pg_cron` schedule `sync-inbound-hub-5min` ogni 5 min via `pg_net.http_post` verso `project--<id>.lovable.app/api/public/hooks/sync-inbound-hub`.

## Connettori richiesti

- **Gmail (google_mail)** connesso a `ilfarmacista.info@gmail.com` (NON una casella personale di farmacia). Stessa connection per tutto il workspace.

## Limiti

- Hub Gmail: ~15.000 email ricevute/giorno (limite Google). Sufficiente per decine di farmacie.
- 5 minuti di latenza media.
- Niente storage PDF persistente: gli allegati restano su Gmail, vengono riscaricati on-demand via `getRicettaAttachment`.
- Niente Outlook/PEC (fase successiva con connector Microsoft Outlook).

## Cosa NON fa

- Non invia email.
- Non legge inbox delle farmacie.
- Non conferma automaticamente l'inoltro Gmail: il codice di conferma arriva nell'hub, va trovato e comunicato manualmente alla farmacia.
