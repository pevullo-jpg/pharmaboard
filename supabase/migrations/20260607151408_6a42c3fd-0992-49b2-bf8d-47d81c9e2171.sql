
CREATE OR REPLACE FUNCTION public.set_farmacia_alias_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.alias_inbound IS NULL OR NEW.alias_inbound = '' THEN
    NEW.alias_inbound := 'farmacia' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;
  RETURN NEW;
END;
$$;
