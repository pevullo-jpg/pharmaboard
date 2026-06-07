
-- Aggiunge colonne per gestire sync Gmail per farmacia
ALTER TABLE public.farmacie
  ADD COLUMN IF NOT EXISTS gmail_email text,
  ADD COLUMN IF NOT EXISTS gmail_sync_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gmail_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS gmail_sync_filters jsonb NOT NULL DEFAULT jsonb_build_object(
    'keywords', ARRAY['ricetta','NRE','prescrizione','promemoria','dematerializzata','DPC'],
    'has_attachment', true,
    'label', null,
    'newer_than_days', 30
  );

-- Tabella log per audit sync
CREATE TABLE IF NOT EXISTS public.gmail_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmacia_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  imported integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'cron'
);

GRANT SELECT ON public.gmail_sync_log TO authenticated;
GRANT ALL ON public.gmail_sync_log TO service_role;

ALTER TABLE public.gmail_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view own sync log"
ON public.gmail_sync_log FOR SELECT
TO authenticated
USING (
  is_super_admin(auth.uid())
  OR farmacia_id = current_farmacia_id(auth.uid())
);

CREATE INDEX IF NOT EXISTS gmail_sync_log_farmacia_started_idx
  ON public.gmail_sync_log (farmacia_id, started_at DESC);
