-- Tier 4 Phase 2: First-time welcome tour flag.
-- Repurposes the (previously unused) users.onboarded_at column as the
-- "has completed the in-app welcome tour" marker. NULL = not yet seen.
-- SECURITY DEFINER so the flip works regardless of per-row UPDATE RLS.

create or replace function public.rpc_complete_onboarding()
returns void
language sql
security definer
set search_path = public
as $$
  update public.users
     set onboarded_at = now()
   where id = auth.uid()
     and onboarded_at is null;
$$;

grant execute on function public.rpc_complete_onboarding() to authenticated;
