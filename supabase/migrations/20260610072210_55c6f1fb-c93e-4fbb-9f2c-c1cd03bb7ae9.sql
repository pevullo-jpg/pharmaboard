ALTER TABLE public.assistiti ADD COLUMN IF NOT EXISTS alias text;
CREATE INDEX IF NOT EXISTS idx_assistiti_alias ON public.assistiti (lower(alias));