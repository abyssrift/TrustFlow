-- Public pre-launch waitlist. Fully anonymous surface (no auth.uid()) reached
-- from the marketing site (website/), so RLS alone isn't enough — every write
-- goes through rpc_waitlist_join, which does its own honeypot + IP-based
-- rate limiting since public._rate_limit (20260701_rate_limits.sql) is
-- keyed on auth.uid() and is a no-op for anonymous callers.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.waitlist_signups (
  id             uuid        primary key default gen_random_uuid(),
  email          text        not null,
  company_name   text        not null,
  ip_hash        text,
  referral_code  text        not null,
  referred_by_id uuid        references public.waitlist_signups (id) on delete set null,
  created_at     timestamptz not null default now()
);

create unique index if not exists waitlist_signups_email_key
  on public.waitlist_signups (lower(email));

create unique index if not exists waitlist_signups_referral_code_key
  on public.waitlist_signups (referral_code);

create index if not exists waitlist_signups_ip_created_idx
  on public.waitlist_signups (ip_hash, created_at);

create index if not exists waitlist_signups_referred_by_idx
  on public.waitlist_signups (referred_by_id);

-- Enable RLS with zero policies: default-deny for anon/authenticated via
-- PostgREST. All access is through the SECURITY DEFINER functions below,
-- which run as the function owner and bypass RLS.
alter table public.waitlist_signups enable row level security;
revoke all on public.waitlist_signups from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Join the waitlist. p_honeypot must stay empty; a real visitor
-- never populates it (kept invisible via CSS in the form). Bots
-- that fill every field get a fake success, not an error, so
-- there's no signal to help them adapt.
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_waitlist_join(
  p_email        text,
  p_company_name text,
  p_honeypot     text default '',
  p_ref_code     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email          text := lower(trim(p_email));
  v_company        text := nullif(trim(p_company_name), '');
  v_ip             text;
  v_ip_hash        text;
  v_recent         int;
  v_status         text;
  v_count          bigint;
  v_code           text := lower(encode(extensions.gen_random_bytes(4), 'hex'));
  v_referred_by_id uuid;
  v_out_code       text;
  v_rows           int;
begin
  if p_honeypot is not null and p_honeypot <> '' then
    return jsonb_build_object('status', 'created', 'count', null, 'referral_code', null);
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;

  if v_company is null then
    raise exception 'Please enter a company name.';
  end if;

  v_ip := split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
    ',', 1
  );
  v_ip := nullif(trim(v_ip), '');
  v_ip_hash := encode(extensions.digest(coalesce(v_ip, 'unknown'), 'sha256'), 'hex');

  select count(*) into v_recent
  from public.waitlist_signups
  where ip_hash = v_ip_hash
    and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'Too many requests. Please try again later.';
  end if;

  if p_ref_code is not null and trim(p_ref_code) <> '' then
    select id into v_referred_by_id
    from public.waitlist_signups
    where referral_code = lower(trim(p_ref_code));
  end if;

  insert into public.waitlist_signups (email, company_name, ip_hash, referral_code, referred_by_id)
  values (v_email, v_company, v_ip_hash, v_code, v_referred_by_id)
  on conflict (lower(email)) do nothing
  returning referral_code into v_out_code;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    v_status := 'duplicate';
    select referral_code into v_out_code
    from public.waitlist_signups
    where lower(email) = v_email;
  else
    v_status := 'created';
  end if;

  select count(*) into v_count from public.waitlist_signups;

  return jsonb_build_object('status', v_status, 'count', v_count, 'referral_code', v_out_code);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Public read-only count for the "N people already joined" counter.
-- Deliberately the only anon-readable surface — no rows, no emails.
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_waitlist_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.waitlist_signups;
$$;

grant execute on function public.rpc_waitlist_join(text, text, text, text) to anon, authenticated;
grant execute on function public.rpc_waitlist_count() to anon, authenticated;
