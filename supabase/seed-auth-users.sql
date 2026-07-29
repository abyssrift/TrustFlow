-- Runs after seed.sql (see supabase/config.toml [db.seed] sql_paths) on every
-- `supabase db reset`. seed.sql restores real prod `public.users` rows with
-- `session_replication_role = replica`, which skips the `users_id_fkey ->
-- auth.users` check — so those rows exist locally with no matching login.
-- This creates that missing `auth.users` (+ `auth.identities`) row for each
-- one, same id (keeps the FK meaningful), same real email, one fixed local
-- dev password. Safe to commit: no customer data lives in this file, it
-- reads whatever's in public.users at reset time.
--
-- Log in locally as any real seeded user with their real email and:
--   localdev123

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change_token_current
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  crypt('localdev123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, u.created_at, u.updated_at,
  '', '', '', ''
from public.users u
where u.deleted_at is null
on conflict (id) do nothing;

insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), u.created_at, u.updated_at
from public.users u
where u.deleted_at is null
on conflict (provider_id, provider) do nothing;
