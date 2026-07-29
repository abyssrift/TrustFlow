-- Tier 4 Phase 5: Billing Integration Foundation (provider-agnostic).
--
-- Foundation only: data entities, pricing properties, and the RPC "seam" a real
-- payment gateway (Stripe/Paddle/etc.) would later plug into. The external_*
-- columns hold whatever a provider needs (customer/subscription ids + a
-- provider tag) without committing to one. No real charges happen here:
-- requesting a paid plan records intent and returns a stub response; switching
-- to a free plan applies immediately.

-- ─────────────────────────────────────────────────────────────
-- Plans (global catalogue)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.billing_plans (
  code        text primary key,
  name        text not null,
  description text,
  price_cents int not null default 0,
  currency    text not null default 'usd',
  interval    text not null default 'month' check (interval in ('month','year')),
  per_seat    boolean not null default true,
  features    jsonb not null default '[]'::jsonb,
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

insert into public.billing_plans (code, name, description, price_cents, per_seat, interval, sort_order, features) values
  ('free',       'Free',       'Get started with the essentials.',            0,    false, 'month', 0,
     '["Up to 5 members","Core tasks & pipelines","Community support"]'::jsonb),
  ('pro',        'Pro',        'For growing teams that need more power.',      1200, true,  'month', 1,
     '["Unlimited members","Advanced analytics","FileHub & versioning","Priority support"]'::jsonb),
  ('business',   'Business',   'Scale with automation and controls.',         2900, true,  'month', 2,
     '["Everything in Pro","Automations & reporting","Data retention controls","SSO (coming soon)"]'::jsonb),
  ('enterprise', 'Enterprise', 'Custom terms for large organisations.',        0,    true,  'month', 3,
     '["Everything in Business","Custom contracts","Dedicated support","Onboarding & SLAs"]'::jsonb)
on conflict (code) do update set
  name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
  per_seat = excluded.per_seat, interval = excluded.interval, sort_order = excluded.sort_order,
  features = excluded.features, is_active = excluded.is_active;

-- ─────────────────────────────────────────────────────────────
-- Per-company billing state
-- ─────────────────────────────────────────────────────────────
create table if not exists public.company_billing (
  company_id              uuid primary key references public.companies(id) on delete cascade,
  plan_code               text not null default 'free' references public.billing_plans(code),
  status                  text not null default 'active'
                            check (status in ('none','trialing','active','past_due','canceled')),
  seats                   int not null default 1,
  external_provider       text,
  external_customer_id    text,
  external_subscription_id text,
  current_period_end      timestamptz,
  trial_ends_at           timestamptz,
  updated_at              timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Billing audit / webhook landing log
-- ─────────────────────────────────────────────────────────────
create table if not exists public.billing_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type       text not null,
  plan_code  text,
  data       jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_billing_events_company on public.billing_events(company_id, created_at desc);

alter table public.billing_plans   enable row level security;
alter table public.company_billing enable row level security;
alter table public.billing_events  enable row level security;

drop policy if exists billing_plans_read on public.billing_plans;
create policy billing_plans_read on public.billing_plans
  for select using (auth.role() = 'authenticated');

drop policy if exists company_billing_read on public.company_billing;
create policy company_billing_read on public.company_billing
  for select using (company_id = public.my_company_id());

drop policy if exists billing_events_read on public.billing_events;
create policy billing_events_read on public.billing_events
  for select using (company_id = public.my_company_id());

-- ─────────────────────────────────────────────────────────────
-- Authorization helper
-- ─────────────────────────────────────────────────────────────
create or replace function public._can_manage_billing()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.users where id = auth.uid()), false)
      or public.has_permission('company.billing');
$$;

-- ─────────────────────────────────────────────────────────────
-- Overview (current state + plan catalogue)
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_billing_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_billing public.company_billing%rowtype;
  v_seats int;
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_billing() then raise exception 'Not authorized'; end if;

  select * into v_billing from public.company_billing where company_id = v_company;
  if not found then
    v_billing.company_id := v_company;
    v_billing.plan_code := 'free';
    v_billing.status := 'active';
    v_billing.seats := 1;
  end if;

  select count(*) into v_seats from public.users where company_id = v_company and deleted_at is null;

  return jsonb_build_object(
    'billing', jsonb_build_object(
      'plan_code', v_billing.plan_code,
      'status', v_billing.status,
      'seats', v_billing.seats,
      'active_members', v_seats,
      'external_provider', v_billing.external_provider,
      'current_period_end', v_billing.current_period_end,
      'trial_ends_at', v_billing.trial_ends_at,
      'connected', v_billing.external_subscription_id is not null
    ),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', p.code, 'name', p.name, 'description', p.description,
               'price_cents', p.price_cents, 'currency', p.currency, 'interval', p.interval,
               'per_seat', p.per_seat, 'features', p.features
             ) order by p.sort_order)
      from public.billing_plans p where p.is_active = true
    ), '[]'::jsonb)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Request a plan change. The integration seam.
--   * Free plan -> applied immediately.
--   * Paid plan -> records intent ('checkout_requested') and returns a stub;
--     a real gateway edge function would create a checkout session and return
--     its URL here instead.
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_request_billing_change(p_plan_code text, p_action text default 'subscribe')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.my_company_id();
  v_plan public.billing_plans%rowtype;
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_billing() then raise exception 'Not authorized'; end if;

  select * into v_plan from public.billing_plans where code = p_plan_code and is_active = true;
  if not found then raise exception 'Unknown plan'; end if;

  -- ensure a billing row exists
  insert into public.company_billing (company_id) values (v_company)
    on conflict (company_id) do nothing;

  if v_plan.price_cents = 0 and v_plan.code <> 'enterprise' then
    -- Free tier: apply immediately, clear any external linkage.
    update public.company_billing
       set plan_code = v_plan.code, status = 'active',
           external_subscription_id = null, current_period_end = null, updated_at = now()
     where company_id = v_company;

    insert into public.billing_events (company_id, type, plan_code, created_by, data)
    values (v_company, 'plan_changed', v_plan.code, auth.uid(), jsonb_build_object('action', p_action));

    return jsonb_build_object('applied', true, 'plan_code', v_plan.code);
  end if;

  -- Paid / enterprise: record intent; no charge yet (gateway not connected).
  insert into public.billing_events (company_id, type, plan_code, created_by, data)
  values (v_company, 'checkout_requested', v_plan.code, auth.uid(), jsonb_build_object('action', p_action));

  return jsonb_build_object(
    'applied', false,
    'stub', true,
    'plan_code', v_plan.code,
    'checkout_url', null,
    'message', 'A payment gateway is not yet connected. Your request was recorded.'
  );
end;
$$;

grant execute on function public.rpc_billing_overview()                         to authenticated;
grant execute on function public.rpc_request_billing_change(text, text)         to authenticated;
