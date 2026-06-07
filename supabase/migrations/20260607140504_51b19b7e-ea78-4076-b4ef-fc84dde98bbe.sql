
-- Default automatico farmacia_id basato su utente corrente
ALTER TABLE public.assistiti    ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id(auth.uid());
ALTER TABLE public.ricette      ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id(auth.uid());
ALTER TABLE public.anticipi     ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id(auth.uid());
ALTER TABLE public.debiti       ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id(auth.uid());
ALTER TABLE public.prenotazioni ALTER COLUMN farmacia_id SET DEFAULT public.current_farmacia_id(auth.uid());

-- Chiudi accesso anonimo alle funzioni helper (rimangono richiamabili solo da authenticated, come richiesto da RLS)
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_farmacia_id(uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_farmacia_attiva(uuid)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_super_admin(uuid)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_farmacia_id(uuid)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_farmacia_attiva(uuid)   TO authenticated;
