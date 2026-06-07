
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('super_admin');
CREATE TYPE public.farmacia_role AS ENUM ('owner', 'staff');
CREATE TYPE public.farmacia_stato AS ENUM ('attiva', 'sospesa', 'disattivata');

-- ============ TABELLA FARMACIE ============
CREATE TABLE public.farmacie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ragione_sociale text,
  partita_iva text,
  indirizzo text,
  citta text,
  cap text,
  telefono text,
  email_contatto text,
  stato public.farmacia_stato NOT NULL DEFAULT 'sospesa',
  attivata_at timestamptz,
  sospesa_at timestamptz,
  note_admin text,
  gmail_connection_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farmacie TO authenticated;
GRANT ALL ON public.farmacie TO service_role;
ALTER TABLE public.farmacie ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER farmacie_set_updated_at BEFORE UPDATE ON public.farmacie
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TABELLA APP_ROLES (super_admin) ============
CREATE TABLE public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.app_roles TO authenticated;
GRANT ALL ON public.app_roles TO service_role;
ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;

-- ============ TABELLA FARMACIA_MEMBERS ============
CREATE TABLE public.farmacia_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmacia_id uuid NOT NULL REFERENCES public.farmacie(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ruolo public.farmacia_role NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farmacia_members TO authenticated;
GRANT ALL ON public.farmacia_members TO service_role;
ALTER TABLE public.farmacia_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX farmacia_members_farmacia_idx ON public.farmacia_members(farmacia_id);

-- ============ SECURITY DEFINER FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_roles WHERE user_id = _uid AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.current_farmacia_id(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT farmacia_id FROM public.farmacia_members WHERE user_id = _uid LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_farmacia_attiva(_farmacia_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.farmacie WHERE id = _farmacia_id AND stato = 'attiva')
$$;

-- ============ POLICIES farmacie / app_roles / members ============
CREATE POLICY "Members view own farmacia" ON public.farmacie
  FOR SELECT TO authenticated
  USING (id = public.current_farmacia_id(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin manages farmacie" ON public.farmacie
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Anyone can self-signup farmacia" ON public.farmacie
  FOR INSERT TO authenticated
  WITH CHECK (stato = 'sospesa');

CREATE POLICY "View own app_roles" ON public.app_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "Super admin manages app_roles" ON public.app_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "View own membership" ON public.farmacia_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR farmacia_id = public.current_farmacia_id(auth.uid())
         OR public.is_super_admin(auth.uid()));

CREATE POLICY "Self insert membership on signup" ON public.farmacia_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Super admin manages memberships" ON public.farmacia_members
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ============ SEED: farmacia Default + utente esistente ============
DO $$
DECLARE
  v_default_id uuid;
  v_user uuid := '5b2290c9-a771-4e4a-8faf-ebff7f8701ac';
BEGIN
  INSERT INTO public.farmacie (nome, stato, attivata_at)
  VALUES ('Farmacia Default', 'attiva', now())
  RETURNING id INTO v_default_id;

  INSERT INTO public.farmacia_members (farmacia_id, user_id, ruolo)
  VALUES (v_default_id, v_user, 'owner');

  INSERT INTO public.app_roles (user_id, role) VALUES (v_user, 'super_admin');

  -- ============ ADD farmacia_id alle tabelle operative ============
  ALTER TABLE public.assistiti ADD COLUMN farmacia_id uuid;
  UPDATE public.assistiti SET farmacia_id = v_default_id;
  ALTER TABLE public.assistiti ALTER COLUMN farmacia_id SET NOT NULL;
  ALTER TABLE public.assistiti ADD CONSTRAINT assistiti_farmacia_fk
    FOREIGN KEY (farmacia_id) REFERENCES public.farmacie(id) ON DELETE RESTRICT;
  CREATE INDEX assistiti_farmacia_idx ON public.assistiti(farmacia_id);

  ALTER TABLE public.ricette ADD COLUMN farmacia_id uuid;
  UPDATE public.ricette SET farmacia_id = v_default_id;
  ALTER TABLE public.ricette ALTER COLUMN farmacia_id SET NOT NULL;
  ALTER TABLE public.ricette ADD CONSTRAINT ricette_farmacia_fk
    FOREIGN KEY (farmacia_id) REFERENCES public.farmacie(id) ON DELETE RESTRICT;
  CREATE INDEX ricette_farmacia_idx ON public.ricette(farmacia_id);

  ALTER TABLE public.anticipi ADD COLUMN farmacia_id uuid;
  UPDATE public.anticipi SET farmacia_id = v_default_id;
  ALTER TABLE public.anticipi ALTER COLUMN farmacia_id SET NOT NULL;
  ALTER TABLE public.anticipi ADD CONSTRAINT anticipi_farmacia_fk
    FOREIGN KEY (farmacia_id) REFERENCES public.farmacie(id) ON DELETE RESTRICT;
  CREATE INDEX anticipi_farmacia_idx ON public.anticipi(farmacia_id);

  ALTER TABLE public.debiti ADD COLUMN farmacia_id uuid;
  UPDATE public.debiti SET farmacia_id = v_default_id;
  ALTER TABLE public.debiti ALTER COLUMN farmacia_id SET NOT NULL;
  ALTER TABLE public.debiti ADD CONSTRAINT debiti_farmacia_fk
    FOREIGN KEY (farmacia_id) REFERENCES public.farmacie(id) ON DELETE RESTRICT;
  CREATE INDEX debiti_farmacia_idx ON public.debiti(farmacia_id);

  ALTER TABLE public.prenotazioni ADD COLUMN farmacia_id uuid;
  UPDATE public.prenotazioni SET farmacia_id = v_default_id;
  ALTER TABLE public.prenotazioni ALTER COLUMN farmacia_id SET NOT NULL;
  ALTER TABLE public.prenotazioni ADD CONSTRAINT prenotazioni_farmacia_fk
    FOREIGN KEY (farmacia_id) REFERENCES public.farmacie(id) ON DELETE RESTRICT;
  CREATE INDEX prenotazioni_farmacia_idx ON public.prenotazioni(farmacia_id);
END $$;

-- ============ SOSTITUISCI RLS POLICIES OPERATIVE ============
DROP POLICY IF EXISTS "Authenticated full access assistiti" ON public.assistiti;
DROP POLICY IF EXISTS "Authenticated full access ricette" ON public.ricette;
DROP POLICY IF EXISTS "Authenticated full access anticipi" ON public.anticipi;
DROP POLICY IF EXISTS "Authenticated full access debiti" ON public.debiti;
DROP POLICY IF EXISTS "Authenticated full access prenotazioni" ON public.prenotazioni;

-- Helper macro inline (5 tabelle, stessa logica)
-- ASSISTITI
CREATE POLICY "Tenant access assistiti" ON public.assistiti FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  );

-- RICETTE
CREATE POLICY "Tenant access ricette" ON public.ricette FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  );

-- ANTICIPI
CREATE POLICY "Tenant access anticipi" ON public.anticipi FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  );

-- DEBITI
CREATE POLICY "Tenant access debiti" ON public.debiti FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  );

-- PRENOTAZIONI
CREATE POLICY "Tenant access prenotazioni" ON public.prenotazioni FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (farmacia_id = public.current_farmacia_id(auth.uid())
        AND public.is_farmacia_attiva(farmacia_id))
  );
