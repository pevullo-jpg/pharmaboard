
ALTER TABLE public.farmacie ADD COLUMN IF NOT EXISTS email_inoltro text;
CREATE UNIQUE INDEX IF NOT EXISTS farmacie_email_inoltro_uniq ON public.farmacie (lower(email_inoltro)) WHERE email_inoltro IS NOT NULL;

DROP FUNCTION IF EXISTS public.set_farmacia_alias_inbound() CASCADE;
ALTER TABLE public.farmacie DROP COLUMN IF EXISTS alias_inbound;

CREATE TABLE IF NOT EXISTS public.inbound_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_email_id text NOT NULL UNIQUE,
  from_email text,
  forwarded_for text,
  subject text,
  snippet text,
  received_at timestamptz,
  stato text NOT NULL DEFAULT 'in_attesa',
  assigned_farmacia_id uuid REFERENCES public.farmacie(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_pending TO authenticated;
GRANT ALL ON public.inbound_pending TO service_role;

ALTER TABLE public.inbound_pending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin manages inbound_pending" ON public.inbound_pending;
CREATE POLICY "Super admin manages inbound_pending"
ON public.inbound_pending FOR ALL TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_inbound_pending_updated_at ON public.inbound_pending;
CREATE TRIGGER trg_inbound_pending_updated_at
BEFORE UPDATE ON public.inbound_pending
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
