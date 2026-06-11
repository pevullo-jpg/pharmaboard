CREATE TABLE public.gmail_oauth_states (
  farmacia_id UUID PRIMARY KEY REFERENCES public.farmacie(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.gmail_oauth_states TO service_role;
ALTER TABLE public.gmail_oauth_states ENABLE ROW LEVEL SECURITY;