-- Tier 4 Phase 4: Data Retention & Inactivity policy.
--
-- Scope (per the product decision):
--   * Track inactivity at BOTH the company (workspace) and individual user level.
--   * The company owner / admin sees a retention dashboard and triggers purges
--     MANUALLY. There is deliberately NO unattended hard-delete cron — the only
--     scheduled job sends warnings. Purges always require an authenticated admin
--     action (and, for a whole company, the owner typing the workspace name).
--
-- Activity signal: users.last_seen_at (fallback created_at). A company's last
-- activity is the most recent last_seen_at across its non-deleted members
-- (fallback the company's created_at).

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────
create table if not exists public.company_retention_settings (
  company_id            uuid primary key references public.companies(id) on delete cascade,
  inactivity_days       int not null default 90  check (inactivity_days between 7 and 3650),
  warning_interval_days int not null default 10  check (warning_interval_days between 1 and 365),
  user_inactivity_days  int not null default 90  check (user_inactivity_days between 7 and 3650),
  warnings_enabled      boolean not null default true,
  updated_by            uuid references public.users(id) on delete set null,
  updated_at            timestamptz not null default now()
);

create table if not exists public.retention_warnings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  scope            text not null default 'company',
  days_inactive    int not null,
  days_until_purge int not null,
  recipients_count int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_retention_warnings_company
  on public.retention_warnings(company_id, created_at desc);

alter table public.company_retention_settings enable row level security;
alter table public.retention_warnings enable row level security;

-- Read-only to company members; all writes go through SECURITY DEFINER RPCs.
drop policy if exists ret_settings_read on public.company_retention_settings;
create policy ret_settings_read on public.company_retention_settings
  for select using (company_id = public.my_company_id());

drop policy if exists ret_warnings_read on public.retention_warnings;
create policy ret_warnings_read on public.retention_warnings
  for select using (company_id = public.my_company_id());

-- ─────────────────────────────────────────────────────────────
-- Authorization helper
-- ─────────────────────────────────────────────────────────────
create or replace function public._can_manage_retention()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_owner from public.users where id = auth.uid()), false)
      or public.has_permission('company.settings')
      or public.has_permission('role.manage');
$$;

-- ─────────────────────────────────────────────────────────────
-- Overview (dashboard data)
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_retention_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.my_company_id();
  v_settings public.company_retention_settings%rowtype;
  v_last_active timestamptz;
  v_days_inactive int;
  v_result jsonb;
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_retention() then raise exception 'Not authorized'; end if;

  -- Lazily ensure a settings row exists (read path may run before any save).
  select * into v_settings from public.company_retention_settings where company_id = v_company;
  if not found then
    v_settings.company_id := v_company;
    v_settings.inactivity_days := 90;
    v_settings.warning_interval_days := 10;
    v_settings.user_inactivity_days := 90;
    v_settings.warnings_enabled := true;
  end if;

  select greatest(
           coalesce(max(u.last_seen_at), 'epoch'::timestamptz),
           (select created_at from public.companies where id = v_company)
         )
    into v_last_active
  from public.users u
  where u.company_id = v_company and u.deleted_at is null;

  v_days_inactive := floor(extract(epoch from (now() - v_last_active)) / 86400)::int;

  select jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company,
      'name', (select name from public.companies where id = v_company),
      'last_active_at', v_last_active,
      'days_inactive', v_days_inactive,
      'inactivity_days', v_settings.inactivity_days,
      'warning_interval_days', v_settings.warning_interval_days,
      'days_until_purge', greatest(v_settings.inactivity_days - v_days_inactive, 0),
      'status', case
                  when v_days_inactive >= v_settings.inactivity_days then 'overdue'
                  when v_days_inactive >= v_settings.inactivity_days - v_settings.warning_interval_days then 'warning'
                  else 'active' end,
      'last_warning_at', (select max(created_at) from public.retention_warnings where company_id = v_company)
    ),
    'settings', jsonb_build_object(
      'inactivity_days', v_settings.inactivity_days,
      'warning_interval_days', v_settings.warning_interval_days,
      'user_inactivity_days', v_settings.user_inactivity_days,
      'warnings_enabled', v_settings.warnings_enabled
    ),
    'inactive_users', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id,
               'full_name', u.full_name,
               'email', u.email,
               'is_owner', u.is_owner,
               'last_seen_at', u.last_seen_at,
               'days_inactive', floor(extract(epoch from (now() - coalesce(u.last_seen_at, u.created_at))) / 86400)::int
             ) order by coalesce(u.last_seen_at, u.created_at) asc)
      from public.users u
      where u.company_id = v_company
        and u.deleted_at is null
        and coalesce(u.last_seen_at, u.created_at) < now() - make_interval(days => v_settings.user_inactivity_days)
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Update settings
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_update_retention_settings(
  p_inactivity_days int,
  p_warning_interval_days int,
  p_user_inactivity_days int,
  p_warnings_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_retention() then raise exception 'Not authorized'; end if;

  insert into public.company_retention_settings as s
    (company_id, inactivity_days, warning_interval_days, user_inactivity_days, warnings_enabled, updated_by, updated_at)
  values
    (v_company, p_inactivity_days, p_warning_interval_days, p_user_inactivity_days, p_warnings_enabled, auth.uid(), now())
  on conflict (company_id) do update set
    inactivity_days       = excluded.inactivity_days,
    warning_interval_days = excluded.warning_interval_days,
    user_inactivity_days  = excluded.user_inactivity_days,
    warnings_enabled      = excluded.warnings_enabled,
    updated_by            = excluded.updated_by,
    updated_at            = now();
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Manual purge: a single inactive user (hard delete, orphan-free)
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_purge_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.my_company_id();
  v_target public.users%rowtype;
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_retention() then raise exception 'Not authorized'; end if;

  select * into v_target from public.users where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  if v_target.company_id is distinct from v_company then raise exception 'User is not in your workspace'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot purge your own account'; end if;
  if coalesce(v_target.is_owner, false) then raise exception 'Cannot purge the workspace owner'; end if;

  -- Nullable references we keep (preserve the workspace's data, drop the person).
  update public.teams    set manager_id  = null where manager_id  = p_user_id;
  update public.users    set reports_to  = null where reports_to  = p_user_id;
  update public.archives set archived_by = null where archived_by = p_user_id;
  update public.archives set restored_by = null where restored_by = p_user_id;

  -- NOT NULL references that can't be orphaned -> delete those owned rows.
  delete from public.task_comments      where author_id = p_user_id;
  delete from public.task_work_sessions where user_id   = p_user_id;

  -- Everything else is ON DELETE CASCADE / SET NULL.
  delete from public.users where id = p_user_id;

  return jsonb_build_object('purged_user', p_user_id, 'email', v_target.email);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Manual purge: an entire workspace (owner only, name confirmation)
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_purge_company(p_company_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.my_company_id();
  v_name text;
  v_is_owner boolean;
begin
  if v_company is null or p_company_id is distinct from v_company then
    raise exception 'You can only purge your own workspace';
  end if;

  select coalesce(is_owner, false) into v_is_owner from public.users where id = auth.uid();
  if not coalesce(v_is_owner, false) then
    raise exception 'Only the workspace owner can purge the company';
  end if;

  select name into v_name from public.companies where id = p_company_id;
  if v_name is null then raise exception 'Company not found'; end if;
  if p_confirm_name is distinct from v_name then
    raise exception 'Confirmation text does not match the workspace name';
  end if;

  -- Clear the company-scoped children whose FK is NO ACTION (would block the
  -- delete). Everything else cascades from companies.
  delete from public.task_comments         where company_id = p_company_id;
  delete from public.task_work_sessions     where company_id = p_company_id;
  delete from public.team_members           where company_id = p_company_id;
  delete from public.team_roles             where company_id = p_company_id;
  delete from public.user_roles             where company_id = p_company_id;
  delete from public.pipeline_stage_targets where company_id = p_company_id;
  delete from public.storage_archive_queue  where company_id = p_company_id;
  delete from public.filehub_file_versions  where company_id = p_company_id;
  delete from public.archives               where company_id = p_company_id;

  delete from public.companies where id = p_company_id;

  return jsonb_build_object('purged_company', p_company_id, 'name', v_name);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Scheduled WARNINGS (no deletion). Sends one in-app notification per
-- warning-interval window once a workspace enters the warning zone.
-- Intended to be driven by pg_cron; not granted to authenticated.
-- ─────────────────────────────────────────────────────────────
create or replace function public.rpc_run_retention_warnings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co record;
  v_last_active timestamptz;
  v_days int;
  v_warn_threshold int;
  v_last_warn timestamptz;
  v_checked int := 0;
  v_warned int := 0;
  v_recipients int;
begin
  for v_co in
    select c.id, c.name, s.inactivity_days, s.warning_interval_days
    from public.companies c
    join public.company_retention_settings s on s.company_id = c.id
    where c.deleted_at is null and s.warnings_enabled = true
  loop
    v_checked := v_checked + 1;

    select greatest(coalesce(max(u.last_seen_at), 'epoch'::timestamptz),
                    (select created_at from public.companies where id = v_co.id))
      into v_last_active
    from public.users u where u.company_id = v_co.id and u.deleted_at is null;

    v_days := floor(extract(epoch from (now() - v_last_active)) / 86400)::int;
    v_warn_threshold := v_co.inactivity_days - v_co.warning_interval_days;

    if v_days < v_warn_threshold then continue; end if;

    select max(created_at) into v_last_warn from public.retention_warnings where company_id = v_co.id;
    if v_last_warn is not null and v_last_warn >= now() - make_interval(days => v_co.warning_interval_days) then
      continue; -- already warned this window
    end if;

    insert into public.notifications (user_id, type, title, body, data)
    select u.id,
           'retention_warning',
           'Workspace inactivity warning',
           'Your workspace "' || v_co.name || '" has been inactive for ' || v_days ||
             ' days and is scheduled for removal in ' || greatest(v_co.inactivity_days - v_days, 0) ||
             ' days. Sign in to keep it active.',
           jsonb_build_object('company_id', v_co.id, 'days_inactive', v_days,
                              'days_until_purge', greatest(v_co.inactivity_days - v_days, 0))
    from public.users u
    where u.company_id = v_co.id and u.deleted_at is null and coalesce(u.is_active, true) = true;

    get diagnostics v_recipients = row_count;

    insert into public.retention_warnings (company_id, scope, days_inactive, days_until_purge, recipients_count)
    values (v_co.id, 'company', v_days, greatest(v_co.inactivity_days - v_days, 0), v_recipients);

    v_warned := v_warned + 1;
  end loop;

  return jsonb_build_object('checked', v_checked, 'warned', v_warned);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────
grant execute on function public.rpc_retention_overview()                              to authenticated;
grant execute on function public.rpc_update_retention_settings(int, int, int, boolean) to authenticated;
grant execute on function public.rpc_purge_user(uuid)                                  to authenticated;
grant execute on function public.rpc_purge_company(uuid, text)                         to authenticated;
-- rpc_run_retention_warnings intentionally NOT granted to authenticated (cron only).

-- ─────────────────────────────────────────────────────────────
-- Schedule the daily warning sweep (best effort; ignore if cron unavailable).
-- ─────────────────────────────────────────────────────────────
do $$
begin
  perform cron.schedule('retention-warnings-daily', '0 8 * * *',
                        'select public.rpc_run_retention_warnings();');
exception when others then
  raise notice 'Skipped scheduling retention warnings: %', sqlerrm;
end $$;
