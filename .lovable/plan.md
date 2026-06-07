## Obiettivo
Costruire una dashboard farmacia per gestire assistiti, debiti, farmaci anticipati/prenotati e ricette, con import automatico da Gmail (PDF + immagini) e parsing AI dei dati ricetta.

## Stack & infrastruttura
- **Lovable Cloud** abilitato (auth + Postgres + RLS).
- **Auth**: email/password (multi-operatore farmacia).
- **Gmail per-utente**: App User Connector (`google_mail`) — ogni operatore collega il proprio Gmail con flusso OAuth popup.
- **Parsing ricette**: Lovable AI Gateway (Gemini 2.5 multimodale) — gestisce sia PDF che immagini scan/foto in un'unica chiamata.
- **UI**: TanStack Start + shadcn, palette **Ocean Deep dark** (#0c2340 base, #1a4a6e surface, #2d8a9e primary, #5cbdb9 accent), font Inter/Sora, card glassmorphism con bordi sottili e glow tenue sull'accent teal.

## Schema database (public)
- `profiles` — id (FK auth.users), nome, ruolo, gmail_connection_id (per-utente).
- `assistiti` — id, nome, cognome, codice_fiscale (unique), medico, esenzione, telefono, note, created_at.
- `ricette` — id, assistito_id (nullable se non matchato), data_ricetta, medico, esenzione, dpc (bool), is_dpc_alert (bool), numero_ricetta, raw_text, source_email_id, pdf_url (storage), stato (nuova/lavorata), created_at.
- `prenotazioni` — id, assistito_id, farmaco, quantità, stato (in_attesa/pronto/consegnato), data, note.
- `anticipi` — id, assistito_id, farmaco, quantità, data, stato (aperto/saldato).
- `debiti` — id, assistito_id, importo, descrizione, stato (aperto/saldato), data.
- Bucket Storage `ricette-pdf` (privato).
- RLS: tutti gli operatori autenticati leggono/scrivono i dati farmacia (single-tenant). `profiles` ognuno il proprio. `gmail_connection_id` solo proprietario.

## Pagine
1. **`/auth`** — login/signup email+password.
2. **`/` (dashboard)** — 4 card riepilogo (Prenotazioni attive, Ricette nuove, DPC da evidenziare, Debiti aperti totali €), tabella ultime ricette importate, pulsante "Sincronizza Gmail".
3. **`/assistiti`** — elenco con ricerca per nome/CF, badge stato (debiti/anticipi/prenotazioni).
4. **`/assistiti/$id`** — dettaglio: anagrafica + 4 tab (Ricette, Prenotazioni, Anticipi, Debiti) con CRUD.
5. **`/impostazioni`** — collegamento Gmail (pulsante "Connetti il mio Gmail"), stato connessione, scollega.

## Flusso Gmail → ricette
1. Operatore connette Gmail in Impostazioni (popup OAuth, scope `gmail.readonly`). Salviamo `connection_id` su `profiles`.
2. Server fn `syncRicette`: chiama `users/me/messages?q=ricetta OR DPC ...` (filtri configurabili), scarica allegati PDF e immagini inline.
3. Per ogni allegato → AI Gateway (Gemini multimodale): prompt strutturato che estrae `{nome, cognome, codice_fiscale, medico, esenzione, data, dpc_flag, numero_ricetta}` in JSON.
4. Upload PDF su Storage, insert in `ricette`, match automatico per CF su `assistiti` (creazione assistito se nuovo, con flag da_confermare).
5. Card dashboard si aggiornano (React Query invalidate).

## Componenti chiave
- `StatCard` (icon, label, valore, trend).
- `RicettaCard` con badge **DPC** ben visibile (accent teal lampeggiante se `is_dpc_alert`).
- `GmailConnectButton` (usa `connectAppUser` helper).
- `AssistitoQuickPanel` con tab.

## Sicurezza
- Service role usato solo lato server (sync Gmail, AI parsing).
- AI Gateway via `LOVABLE_API_KEY` server-side.
- Validazione Zod su tutti gli input.
- RLS attive, GRANT a `authenticated`.

## Cosa NON includo in questa prima passata
- Notifiche SMS/email al cliente.
- Stampa etichette/ricevute.
- Storico/audit dettagliato.
- Multi-farmacia (tenancy).

Possiamo aggiungerli dopo se servono.
