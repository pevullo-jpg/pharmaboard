
-- Riassegna ricette dell'assistito duplicato a quello "principale" (stesso nome+cognome, CF valido)
WITH dupes AS (
  SELECT a1.id AS keep_id, a2.id AS drop_id
  FROM public.assistiti a1
  JOIN public.assistiti a2
    ON a1.farmacia_id = a2.farmacia_id
   AND lower(a1.cognome) = lower(a2.cognome)
   AND lower(a1.nome) = lower(a2.nome)
   AND a1.id < a2.id
)
UPDATE public.ricette r
SET assistito_id = d.keep_id
FROM dupes d
WHERE r.assistito_id = d.drop_id;

-- Elimina assistiti duplicati (per nome+cognome dentro la stessa farmacia)
DELETE FROM public.assistiti a
USING public.assistiti a2
WHERE a.farmacia_id = a2.farmacia_id
  AND lower(a.cognome) = lower(a2.cognome)
  AND lower(a.nome) = lower(a2.nome)
  AND a.id > a2.id;

-- Rimuove l'indice univoco (farmacia, cognome, nome) — non più usato
DROP INDEX IF EXISTS public.assistiti_farmacia_nome_uidx;
