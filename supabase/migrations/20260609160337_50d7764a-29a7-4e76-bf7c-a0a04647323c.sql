ALTER TABLE public.assistiti DROP CONSTRAINT IF EXISTS assistiti_codice_fiscale_key;

CREATE UNIQUE INDEX IF NOT EXISTS assistiti_farmacia_cf_uniq
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

DROP TRIGGER IF EXISTS assistiti_set_farmacia_id ON public.assistiti;
CREATE TRIGGER assistiti_set_farmacia_id
  BEFORE INSERT ON public.assistiti
  FOR EACH ROW EXECUTE FUNCTION public.set_assistiti_farmacia_id();

UPDATE public.ricette r
SET assistito_id = a.id
FROM public.assistiti a
WHERE r.assistito_id IS NULL
  AND r.codice_fiscale IS NOT NULL
  AND a.farmacia_id = r.farmacia_id
  AND a.codice_fiscale = r.codice_fiscale;