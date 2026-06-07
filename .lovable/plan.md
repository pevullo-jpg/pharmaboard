## Obiettivo

Trasformare l'app in un sistema multi-tenant dove ogni farmacia ha un proprio account, vede solo i propri dati, e l'attivazione/disattivazione è gestita da un super-admin.

## Modello dati

Introduciamo il concetto di **farmacia** (tenant) e leghiamo tutti i dati operativi a un `farmacia_id`. Gli utenti vengono associati a una farmacia tramite una tabella di membership; i ruoli (super_admin, pharmacy_owner, pharmacy_staff) vivono in una tabella separata per evitare escalation di privilegi.

### Nuove tabelle

1. **`farmacie`** — anagrafica tenant
   - `nome`, `ragione_sociale`, `partita_iva`, `indirizzo`, `citta`, `cap`, `telefono`, `email_contatto`
   - `stato`: `attiva` | `sospesa` | `disattivata` (default: `sospesa`)
   - `attivata_at`, `sospesa_at`, `note_admin`
   - `gmail_connection_id` (la connessione Gmail diventa per-farmacia, non globale)

2. **`farmacia_members`** — associazione user ↔ farmacia
   - `farmacia_id`, `user_id`, `ruolo_farmacia` (owner/staff)
   - Una farmacia può avere più utenti; un utente appartiene a una sola farmacia (vincolo unique su user_id)

3. **`app_roles`** — ruoli globali (enum: `super_admin`)
   - `user_id`, `role`
   - Usata solo per i super-admin della piattaforma; il ruolo nella farmacia sta in `farmacia_members`

4. **Funzioni security definer**
   - `is_super_admin(uid)` — controlla `app_roles`
   - `current_farmacia_id(uid)` — ritorna la farmacia dell'utente da `farmacia_members`
   - `is_farmacia_attiva(farmacia_id)` — controlla `stato = 'attiva'`

### Modifiche tabelle esistenti

Aggiungo `farmacia_id NOT NULL` a:
- `assistiti`
- `ricette`
- `anticipi`
- `debiti`
- `prenotazioni`

**Migrazione dati esistenti**: poiché siamo in fase di sviluppo e i dati attuali appartengono a una sola farmacia di test, creo una farmacia "Default" e assegno tutti i record esistenti ad essa (con valore di default temporaneo, poi rendo NOT NULL).

### RLS

Sostituisco le policy attuali (`USING (true)`) con policy basate su `farmacia_id = current_farmacia_id(auth.uid()) AND is_farmacia_attiva(farmacia_id)`. I super-admin hanno accesso completo via `is_super_admin(auth.uid())`.

**Risultato:**
- Una farmacia sospesa/disattivata → i suoi utenti non vedono più alcun dato (login funziona ma queries ritornano vuote)
- Cross-tenant isolation garantita a livello database (non si può bucare via API)

## Flusso di onboarding

1. **Self-signup farmacia**: nuova pagina `/registra-farmacia` dove il titolare crea account + farmacia (stato iniziale `sospesa`)
2. **Approvazione super-admin**: il super-admin vede in dashboard la lista farmacie pendenti e clicca "Attiva"
3. **Login farmacia**: dopo l'attivazione, l'utente accede normalmente e vede solo i propri dati
4. **Gestione Gmail**: la connessione Gmail diventa per-farmacia (campo `gmail_connection_id` su `farmacie`). Per ora resta la connessione globale del workspace Lovable (limite tecnico del connettore — vedi nota sotto)

## Pannello super-admin

Nuova route protetta `/_authenticated/admin/farmacie` (visibile solo se `is_super_admin`):
- Tabella farmacie con stato, data registrazione, numero utenti, numero ricette
- Azioni: Attiva, Sospendi, Disattiva, modifica anagrafica, note interne
- Filtro per stato

## UI dell'app

- Header dell'app mostra il nome della farmacia corrente
- Nuova voce "Farmacie" nel menu (solo super-admin)
- Schermata "In attesa di attivazione" quando l'utente è loggato ma la sua farmacia è `sospesa`

## Limite tecnico Gmail multi-farmacia

Il connettore Gmail di Lovable autorizza **l'account Gmail del workspace builder**, non un Gmail per farmacia. Opzioni:

**A. Una sola casella Gmail centralizzata** (più semplice, MVP): tutte le farmacie ricevono ricette su un'unica casella, e si discrimina per destinatario (es. `farmacia1@dominio.it`, `farmacia2@dominio.it` come alias). Il sync filtra per indirizzo destinatario e assegna il `farmacia_id` di conseguenza.

**B. OAuth Google per-farmacia** (corretta a regime): ogni farmacia connette il proprio Gmail con OAuth Google standard. Richiede progetto Google Cloud, OAuth consent screen e gestione token per-farmacia in tabella dedicata. Lavoro extra significativo.

**Proposta**: partire con A (1 settimana), passare a B quando l'app supera le ~5 farmacie reali.

## Piano implementazione

1. Migrazione DB: `farmacie`, `farmacia_members`, `app_roles`, security definer functions, `farmacia_id` su tabelle esistenti, nuove RLS
2. Bootstrap: creare farmacia "Default" + assegnare l'utente attuale come super_admin + owner
3. Server functions: `getCurrentFarmacia`, `listFarmacie` (admin), `attivaFarmacia`, `sospendiFarmacia`, `registraNuovaFarmacia`
4. UI:
   - Pagina `/registra-farmacia` (pubblica)
   - Pagina "In attesa di attivazione"
   - Pannello `/admin/farmacie` (super-admin)
   - Badge farmacia nell'app shell
5. Adeguare il sync Gmail con filtro destinatario e assegnazione `farmacia_id`
6. Test isolamento: creare 2 farmacie e verificare che non si vedano i dati a vicenda

## Domande di conferma

1. **Modello Gmail**: confermi opzione A (casella centralizzata con alias per farmacia) per iniziare?
2. **Multi-utente per farmacia**: una farmacia può avere più dipendenti che accedono, oppure un solo account per farmacia?
3. **Self-signup o invito**: le farmacie si registrano da sole (e poi tu approvi) o tu le crei manualmente da super-admin e invii credenziali?
4. **Super-admin iniziale**: confermi che il tuo utente attuale (quello con cui sei loggato adesso) debba diventare super_admin?
