
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  gmail_connection_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Assistiti (shared across all operators in the pharmacy)
CREATE TABLE public.assistiti (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  codice_fiscale TEXT UNIQUE,
  medico TEXT,
  esenzione TEXT,
  telefono TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistiti TO authenticated;
GRANT ALL ON public.assistiti TO service_role;
ALTER TABLE public.assistiti ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access assistiti" ON public.assistiti FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Ricette
CREATE TABLE public.ricette (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assistito_id UUID REFERENCES public.assistiti(id) ON DELETE SET NULL,
  nome TEXT,
  cognome TEXT,
  codice_fiscale TEXT,
  medico TEXT,
  esenzione TEXT,
  data_ricetta DATE,
  numero_ricetta TEXT,
  dpc BOOLEAN NOT NULL DEFAULT false,
  is_dpc_alert BOOLEAN NOT NULL DEFAULT false,
  stato TEXT NOT NULL DEFAULT 'nuova',
  source TEXT NOT NULL DEFAULT 'manuale',
  source_email_id TEXT,
  pdf_url TEXT,
  raw_text TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ricette TO authenticated;
GRANT ALL ON public.ricette TO service_role;
ALTER TABLE public.ricette ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access ricette" ON public.ricette FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Prenotazioni
CREATE TABLE public.prenotazioni (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assistito_id UUID NOT NULL REFERENCES public.assistiti(id) ON DELETE CASCADE,
  farmaco TEXT NOT NULL,
  quantita INTEGER NOT NULL DEFAULT 1,
  stato TEXT NOT NULL DEFAULT 'in_attesa',
  data_prenotazione DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prenotazioni TO authenticated;
GRANT ALL ON public.prenotazioni TO service_role;
ALTER TABLE public.prenotazioni ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access prenotazioni" ON public.prenotazioni FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anticipi (farmaci anticipati)
CREATE TABLE public.anticipi (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assistito_id UUID NOT NULL REFERENCES public.assistiti(id) ON DELETE CASCADE,
  farmaco TEXT NOT NULL,
  quantita INTEGER NOT NULL DEFAULT 1,
  stato TEXT NOT NULL DEFAULT 'aperto',
  data_anticipo DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anticipi TO authenticated;
GRANT ALL ON public.anticipi TO service_role;
ALTER TABLE public.anticipi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access anticipi" ON public.anticipi FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Debiti
CREATE TABLE public.debiti (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assistito_id UUID NOT NULL REFERENCES public.assistiti(id) ON DELETE CASCADE,
  importo NUMERIC(10,2) NOT NULL,
  descrizione TEXT,
  stato TEXT NOT NULL DEFAULT 'aperto',
  data_debito DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.debiti TO authenticated;
GRANT ALL ON public.debiti TO service_role;
ALTER TABLE public.debiti ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated full access debiti" ON public.debiti FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_profiles_uat BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assistiti_uat BEFORE UPDATE ON public.assistiti FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_ricette_uat BEFORE UPDATE ON public.ricette FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_prenotazioni_uat BEFORE UPDATE ON public.prenotazioni FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_anticipi_uat BEFORE UPDATE ON public.anticipi FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_debiti_uat BEFORE UPDATE ON public.debiti FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helpful indexes
CREATE INDEX idx_ricette_assistito ON public.ricette(assistito_id);
CREATE INDEX idx_ricette_cf ON public.ricette(codice_fiscale);
CREATE INDEX idx_prenotazioni_assistito ON public.prenotazioni(assistito_id);
CREATE INDEX idx_anticipi_assistito ON public.anticipi(assistito_id);
CREATE INDEX idx_debiti_assistito ON public.debiti(assistito_id);
CREATE INDEX idx_assistiti_cf ON public.assistiti(codice_fiscale);
