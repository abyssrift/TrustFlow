-- 20260721_import_connections.sql
-- Stores third-party import connections (OAuth tokens, API keys) per user.
-- Tokens are encrypted at rest via pgcrypto. The import-proxy Edge Function
-- reads this table (via service_role) to make authenticated API calls.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.import_connections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  provider    text not null check (provider in ('jira', 'odoo', 'trello')),
  -- pgp_sym_encrypt / pgp_sym_decrypt with a key stored in Supabase Vault
  encrypted_tokens text not null,
  instance_url text,         -- Odoo self-hosted URL, Jira Data Center URL
  provider_user_id text,     -- Jira account ID / Trello member ID for display
  provider_display_name text,-- e.g. "John (jira.acme.com)"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, provider, coalesce(instance_url, ''))
);

-- RLS: user can only see/edit their own connections
alter table public.import_connections enable row level security;

create policy "import_connections_own_select"
  on public.import_connections for select
  using (user_id = auth.uid());

create policy "import_connections_own_insert"
  on public.import_connections for insert
  with check (user_id = auth.uid());

create policy "import_connections_own_delete"
  on public.import_connections for delete
  using (user_id = auth.uid());

-- updated_at trigger
create or replace function public.set_import_connections_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_import_connections_updated_at
  before update on public.import_connections
  for each row execute function public.set_import_connections_updated_at();
