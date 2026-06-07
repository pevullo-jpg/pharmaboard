ALTER TABLE public.farmacie
  ADD COLUMN IF NOT EXISTS data_stop_servizi date NOT NULL DEFAULT '2027-01-01';