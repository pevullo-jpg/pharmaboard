## Obiettivo

Quando arriva una sintesi con solo CF e l'assistito non esiste nella farmacia corrente, cercare lo stesso CF in altre farmacie. Se trovato con nome reale, copiare nome/cognome (ed eventuali altri dati anagrafici disponibili) invece di creare un placeholder `(sconosciuto)`.

## Modifiche

### `src/lib/gmail.functions.ts` — funzione `resolveAssistito` (ramo "solo CF")

Prima di creare il record placeholder per `(farmacia_id, codice_fiscale)`:

1. Query con `supabaseAdmin` (bypassa RLS, necessario per leggere altre farmacie):
   ```
   SELECT nome, cognome, data_nascita, luogo_nascita, telefono
   FROM assistiti
   WHERE codice_fiscale = :cf
     AND farmacia_id <> :current_farmacia
     AND nome <> '(sconosciuto)'
   ORDER BY updated_at DESC
   LIMIT 1
   ```
2. Se trovato → crea il nuovo assistito nella farmacia corrente copiando nome/cognome (+ data_nascita / luogo_nascita / telefono se presenti).
3. Se non trovato → comportamento attuale: placeholder `(sconosciuto)`.

Il telefono viene copiato solo se la colonna è ammessa dallo schema attuale (verifico in fase di build); altrimenti solo nome/cognome/data_nascita/luogo_nascita.

### Backfill placeholder esistenti

Migrazione una-tantum (UPDATE via insert tool, non DDL):

```sql
UPDATE public.assistiti a
SET nome = src.nome,
    cognome = src.cognome,
    data_nascita = COALESCE(a.data_nascita, src.data_nascita),
    luogo_nascita = COALESCE(a.luogo_nascita, src.luogo_nascita)
FROM (
  SELECT DISTINCT ON (codice_fiscale)
         codice_fiscale, nome, cognome, data_nascita, luogo_nascita
  FROM public.assistiti
  WHERE nome <> '(sconosciuto)'
  ORDER BY codice_fiscale, updated_at DESC
) src
WHERE a.codice_fiscale = src.codice_fiscale
  AND a.nome = '(sconosciuto)';
```

Aggiorna in particolare il Carlino Salvatore della farmacia B con i dati della farmacia A.

## Note privacy

Il lookup attraversa i confini delle farmacie usando il service role. Il dato copiato è anagrafica minima (nome, cognome, ed eventualmente data/luogo di nascita) — niente storico ricette o dati clinici. Confermi che va bene così, oppure preferisci limitare a solo nome + cognome?

## File toccati

- `src/lib/gmail.functions.ts` (modifica `resolveAssistito`)
- 1 UPDATE SQL per il backfill
