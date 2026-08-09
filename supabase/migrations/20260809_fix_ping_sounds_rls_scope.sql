-- The live SELECT policy on company_ping_sounds had regressed to
-- `USING (true)` (not from any tracked migration — changed directly on the
-- database). That let every authenticated user read every company's row,
-- and once a second company got a row (2026-07-21), it broke every
-- unfiltered `.single()`/`.maybeSingle()` read of this table for everyone:
-- Postgrest errors when RLS lets through more than one row for those calls,
-- silently killing ping sound playback and the admin "current sound" panel.

DROP POLICY IF EXISTS "Users can view company ping sounds" ON public.company_ping_sounds;

CREATE POLICY "Users can view company ping sounds" ON public.company_ping_sounds
FOR SELECT TO authenticated
USING (
  company_id = public.my_company_id()
);
