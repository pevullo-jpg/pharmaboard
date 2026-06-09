## Problema

La tabella `assistiti` ha un vincolo `UNIQUE(codice_fiscale)` **globale**. Questo impedisce che lo stesso codice fiscale possa esistere in più farmacie, ma il modello reale prevede che ogni farmacia abbia il proprio record (con dati propri: medico, esenzione, note, telefono, debiti, anticipi, prenotazioni, ricette).

Conseguenze osservate:
- "Non vengono creati assistiti": l'insert da `Nuovo assistito` non passa `farmacia_id` esplicito e quindi viola la RLS (la policy richiede `farmacia_id = current_farmacia_id(...)`).
- "Lombardo Eliana — due copie della stessa ricetta in dashboard": quando il CF esiste già in un'altra farmacia, `resolveOrCreateAssistito` non riesce a creare il record nella farmacia corrente (UNIQUE globale) e ritorna `null`; le ricette vengono salvate con `assistito_id = null`, perdono i raggruppamenti e i badge, e finiscono renderizzate come righe separate.
- Badge assenti sulle righe in dashboard: stessa radice (assistito mancante nella farmacia corrente).

## Cosa fare

### 1) Migration sul DB

- Rimuovere `UNIQUE(codice_fiscale)` globale su `public.assistiti`.
- Aggiungere `UNIQUE(farmacia_id, codice_fiscale)` (parziale, solo dove `codice_fiscale IS NOT NULL`).
- Aggiungere un trigger `BEFORE INSERT` su `public.assistiti` che, se `farmacia_id` è NULL, lo imposta a `public.current_farmacia_id(auth.uid())`. Così l'insert dal client non deve preoccuparsi di passarlo e la RLS continua a validarlo.
- Bonifica dati: nessun cambio distruttivo, ma se esistono ricette con `codice_fiscale` valorizzato e `assistito_id = NULL`, fare un UPDATE che le ricollega all'assistito della stessa farmacia con lo stesso CF (se esiste).

### 2) Codice client/server

- `src/routes/_authenticated/assistiti.tsx`: non serve modificare l'insert (il trigger pensa al `farmacia_id`), ma aggiungere un messaggio d'errore user-friendly se l'insert fallisce per duplicato `(farmacia_id, codice_fiscale)` ("Esiste già un assistito con questo codice fiscale in questa farmacia").
- `src/lib/gmail.functions.ts` (`resolveOrCreateAssistito`): la logica è già scoped per `(farmacia_id, codice_fiscale)`, quindi una volta rimosso l'UNIQUE globale funzionerà. Nessuna modifica funzionale necessaria; lascio il retry-on-race com'è.
- Niente da cambiare su `ricette`/`debiti`/`anticipi`/`prenotazioni`: già hanno `farmacia_id` + FK su `assistiti(id)` con `ON DELETE CASCADE/SET NULL` e RLS per tenant.

### 3) Verifica post-fix

- Creare manualmente un assistito dal pannello (regressione risolta).
- Eseguire un import Gmail su una farmacia diversa con un CF già presente altrove: deve creare un nuovo `assistiti` row nella farmacia corrente e collegare le ricette correttamente.
- Controllare che i badge (debiti/anticipi/prenotazioni) tornino sulle righe della dashboard.

## Dettaglio tecnico (SQL della migration)

```sql
ALTER TABLE public.assistiti DROP CONSTRAINT assistiti_codice_fiscale_key;

CREATE UNIQUE INDEX assistiti_farmacia_cf_uniq
  ON public.assistiti (farmacia_id, codice_fiscale)
  WHERE codice_fiscale IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_assistiti_farmacia_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.farmacia_id IS NULL THEN
    NEW.farmacia_id := public.current_farmacia_id(auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assistiti_set_farmacia_id
  BEFORE INSERT ON public.assistiti
  FOR EACH ROW EXECUTE FUNCTION public.set_assistiti_farmacia_id();

-- Bonifica: ricollega ricette orfane all'assistito della stessa farmacia/CF
UPDATE public.ricette r
SET assistito_id = a.id
FROM public.assistiti a
WHERE r.assistito_id IS NULL
  AND r.codice_fiscale IS NOT NULL
  AND a.farmacia_id = r.farmacia_id
  AND a.codice_fiscale = r.codice_fiscale;
```

## Cosa NON cambia

- Schema `ricette`, `debiti`, `anticipi`, `prenotazioni`, `farmacia_members`, RLS esistenti.
- Logica di dedup ricette per `(farmacia_id, numero_ricetta)`.
