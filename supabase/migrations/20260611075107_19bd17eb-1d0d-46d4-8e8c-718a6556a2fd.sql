-- Tabella riservata ai token Gmail delle farmacie: accesso esclusivo lato server (service role).
CREATE TABLE public.farmacia_gmail_tokens (
  farmacia_id uuid PRIMARY KEY REFERENCES public.farmacie(id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  gmail_email text,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- NESSUN grant ad anon/authenticated: il token non deve mai essere leggibile dal client.
GRANT ALL ON public.farmacia_gmail_tokens TO service_role;
ALTER TABLE public.farmacia_gmail_tokens ENABLE ROW LEVEL SECURITY;
-- Nessuna policy: la tabella è raggiungibile solo con il service role.

CREATE TRIGGER set_farmacia_gmail_tokens_updated_at
BEFORE UPDATE ON public.farmacia_gmail_tokens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Il vecchio sistema hub (email inoltrate all'account centrale) viene smantellato.
DROP TABLE IF EXISTS public.inbound_pending;