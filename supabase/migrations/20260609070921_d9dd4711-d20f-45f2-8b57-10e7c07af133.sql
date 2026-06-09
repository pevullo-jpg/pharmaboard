ALTER TABLE public.ricette ADD COLUMN IF NOT EXISTS codice_regionale text;
ALTER TABLE public.ricette ADD COLUMN IF NOT EXISTS tipo_documento text NOT NULL DEFAULT 'ricetta';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ricette_farmacia_nre ON public.ricette (farmacia_id, numero_ricetta) WHERE numero_ricetta IS NOT NULL;