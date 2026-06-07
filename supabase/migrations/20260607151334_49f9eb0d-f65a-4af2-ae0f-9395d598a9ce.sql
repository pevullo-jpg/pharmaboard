
-- 1. Wipe test data from ricette
DELETE FROM public.ricette;

-- 2. Drop old per-farmacia Gmail columns
ALTER TABLE public.farmacie
  DROP COLUMN IF EXISTS gmail_connection_id,
  DROP COLUMN IF EXISTS gmail_email,
  DROP COLUMN IF EXISTS gmail_sync_filters,
  DROP COLUMN IF EXISTS gmail_sync_enabled,
  DROP COLUMN IF EXISTS gmail_last_sync_at;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS gmail_connection_id;

-- 3. Drop sync log table (replaced by hub-level cron logs)
DROP TABLE IF EXISTS public.gmail_sync_log;

-- 4. Add alias_inbound to farmacie
ALTER TABLE public.farmacie
  ADD COLUMN IF NOT EXISTS alias_inbound text;

-- Backfill aliases for existing farmacie: "farmacia" + first 8 hex chars of id
UPDATE public.farmacie
SET alias_inbound = 'farmacia' || substr(replace(id::text, '-', ''), 1, 8)
WHERE alias_inbound IS NULL;

ALTER TABLE public.farmacie
  ALTER COLUMN alias_inbound SET NOT NULL,
  ADD CONSTRAINT farmacie_alias_inbound_key UNIQUE (alias_inbound);

-- 5. Trigger to auto-generate alias_inbound for new farmacie
CREATE OR REPLACE FUNCTION public.set_farmacia_alias_inbound()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.alias_inbound IS NULL OR NEW.alias_inbound = '' THEN
    NEW.alias_inbound := 'farmacia' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_farmacie_set_alias_inbound ON public.farmacie;
CREATE TRIGGER trg_farmacie_set_alias_inbound
  BEFORE INSERT ON public.farmacie
  FOR EACH ROW
  EXECUTE FUNCTION public.set_farmacia_alias_inbound();
