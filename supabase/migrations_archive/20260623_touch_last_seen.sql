-- Tier 4 Phase 4 follow-up: users.last_seen_at was read by the retention
-- dashboard (rpc_retention_overview) but never written anywhere, so every
-- company's "last activity" silently fell back to companies.created_at
-- regardless of real usage. This adds the missing write path.

create or replace function public.rpc_touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.users set last_seen_at = now() where id = auth.uid();
$$;

grant execute on function public.rpc_touch_last_seen() to authenticated;
