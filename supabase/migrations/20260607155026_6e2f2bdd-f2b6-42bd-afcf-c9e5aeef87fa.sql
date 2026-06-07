
-- 1) Unique on (farmacia_id, codice_fiscale) when CF present
CREATE UNIQUE INDEX IF NOT EXISTS assistiti_farmacia_cf_uidx
  ON public.assistiti (farmacia_id, codice_fiscale)
  WHERE codice_fiscale IS NOT NULL;

-- 2) Unique on (farmacia_id, lower(cognome), lower(nome)) when CF is null
CREATE UNIQUE INDEX IF NOT EXISTS assistiti_farmacia_nome_uidx
  ON public.assistiti (farmacia_id, lower(cognome), lower(nome))
  WHERE codice_fiscale IS NULL;

-- 3) Backfill: collega ricette orfane per CF
UPDATE public.ricette r
SET assistito_id = a.id
FROM public.assistiti a
WHERE r.assistito_id IS NULL
  AND r.codice_fiscale IS NOT NULL
  AND a.codice_fiscale = r.codice_fiscale
  AND a.farmacia_id = r.farmacia_id;

-- 4) Backfill: crea assistiti mancanti dalle ricette orfane con CF
INSERT INTO public.assistiti (farmacia_id, nome, cognome, codice_fiscale, medico, esenzione)
SELECT DISTINCT ON (r.farmacia_id, r.codice_fiscale)
  r.farmacia_id,
  COALESCE(r.nome, ''),
  COALESCE(r.cognome, ''),
  r.codice_fiscale,
  r.medico,
  r.esenzione
FROM public.ricette r
WHERE r.assistito_id IS NULL
  AND r.codice_fiscale IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.assistiti a
    WHERE a.farmacia_id = r.farmacia_id AND a.codice_fiscale = r.codice_fiscale
  )
ON CONFLICT DO NOTHING;

-- 5) Rilink dopo l'insert
UPDATE public.ricette r
SET assistito_id = a.id
FROM public.assistiti a
WHERE r.assistito_id IS NULL
  AND r.codice_fiscale IS NOT NULL
  AND a.codice_fiscale = r.codice_fiscale
  AND a.farmacia_id = r.farmacia_id;

-- 6) Backfill: crea assistiti mancanti dalle ricette orfane SENZA CF (per nome+cognome)
INSERT INTO public.assistiti (farmacia_id, nome, cognome, medico, esenzione)
SELECT DISTINCT ON (r.farmacia_id, lower(r.cognome), lower(r.nome))
  r.farmacia_id, r.nome, r.cognome, r.medico, r.esenzione
FROM public.ricette r
WHERE r.assistito_id IS NULL
  AND r.codice_fiscale IS NULL
  AND COALESCE(r.cognome,'') <> ''
  AND COALESCE(r.nome,'') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.assistiti a
    WHERE a.farmacia_id = r.farmacia_id
      AND lower(a.cognome) = lower(r.cognome)
      AND lower(a.nome) = lower(r.nome)
  )
ON CONFLICT DO NOTHING;

-- 7) Rilink ricette senza CF per nome+cognome
UPDATE public.ricette r
SET assistito_id = a.id
FROM public.assistiti a
WHERE r.assistito_id IS NULL
  AND COALESCE(r.cognome,'') <> ''
  AND COALESCE(r.nome,'') <> ''
  AND a.farmacia_id = r.farmacia_id
  AND lower(a.cognome) = lower(r.cognome)
  AND lower(a.nome) = lower(r.nome);
