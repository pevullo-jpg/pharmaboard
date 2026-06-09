CREATE UNIQUE INDEX IF NOT EXISTS ricette_farmacia_nre_unique
ON public.ricette (farmacia_id, numero_ricetta)
WHERE numero_ricetta IS NOT NULL;