DROP POLICY IF EXISTS "Self insert membership on signup" ON public.farmacia_members;
ALTER TABLE public.farmacia_members ADD CONSTRAINT farmacia_members_user_unique UNIQUE (user_id);