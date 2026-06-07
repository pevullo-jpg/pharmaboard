CREATE INDEX IF NOT EXISTS idx_ricette_farmacia_data ON public.ricette (farmacia_id, data_ricetta DESC);
CREATE INDEX IF NOT EXISTS idx_ricette_farmacia_stato ON public.ricette (farmacia_id, stato);
CREATE INDEX IF NOT EXISTS idx_ricette_farmacia_cf ON public.ricette (farmacia_id, codice_fiscale);
CREATE INDEX IF NOT EXISTS idx_ricette_farmacia_source_email ON public.ricette (farmacia_id, source_email_id);
CREATE INDEX IF NOT EXISTS idx_ricette_assistito ON public.ricette (assistito_id);
CREATE INDEX IF NOT EXISTS idx_ricette_created_at ON public.ricette (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistiti_farmacia_cognome ON public.assistiti (farmacia_id, cognome);
CREATE INDEX IF NOT EXISTS idx_assistiti_farmacia_cf ON public.assistiti (farmacia_id, codice_fiscale);

CREATE INDEX IF NOT EXISTS idx_anticipi_farmacia_stato ON public.anticipi (farmacia_id, stato);
CREATE INDEX IF NOT EXISTS idx_anticipi_assistito ON public.anticipi (assistito_id);

CREATE INDEX IF NOT EXISTS idx_prenotazioni_farmacia_stato ON public.prenotazioni (farmacia_id, stato);
CREATE INDEX IF NOT EXISTS idx_prenotazioni_assistito ON public.prenotazioni (assistito_id);

CREATE INDEX IF NOT EXISTS idx_debiti_farmacia_stato ON public.debiti (farmacia_id, stato);
CREATE INDEX IF NOT EXISTS idx_debiti_assistito ON public.debiti (assistito_id);

CREATE INDEX IF NOT EXISTS idx_farmacia_members_user ON public.farmacia_members (user_id);
CREATE INDEX IF NOT EXISTS idx_farmacia_members_farmacia ON public.farmacia_members (farmacia_id);