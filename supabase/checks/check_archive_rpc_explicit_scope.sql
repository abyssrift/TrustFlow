-- Issue #431: omitted/false company expansion stays scoped; true requires the
-- independent archive.view + archive.view_all permissions.
-- Run after migrations with:
--   npx supabase db query --local -f supabase/checks/check_archive_rpc_explicit_scope.sql
BEGIN;

CREATE TEMP TABLE archive_explicit_scope_ctx (
  company_id uuid,
  other_company_id uuid,
  caller_id uuid,
  modifier_only_id uuid,
  creator_id uuid,
  company_archive_id uuid,
  foreign_archive_id uuid
);
GRANT SELECT ON archive_explicit_scope_ctx TO authenticated;

DO $fixture$
DECLARE
  c uuid;
  c2 uuid;
  caller uuid := gen_random_uuid();
  modifier_only uuid := gen_random_uuid();
  creator uuid := gen_random_uuid();
  caller_role uuid;
  modifier_role uuid;
  a_company uuid;
  a_foreign uuid;
  u uuid;
BEGIN
  INSERT INTO public.companies(name, slug)
  VALUES ('#431 explicit-scope check', 'archive-scope-' || replace(gen_random_uuid()::text, '-', ''))
  RETURNING id INTO c;
  INSERT INTO public.companies(name, slug)
  VALUES ('#431 foreign explicit-scope check', 'archive-scope-' || replace(gen_random_uuid()::text, '-', ''))
  RETURNING id INTO c2;

  FOREACH u IN ARRAY ARRAY[caller, modifier_only, creator] LOOP
    INSERT INTO auth.users(
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      u, 'authenticated', 'authenticated',
      'archive-scope-' || replace(u::text, '-', '') || '@example.invalid',
      '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    );
    INSERT INTO public.users(id, company_id, email, full_name, is_owner)
    VALUES (
      u, CASE WHEN u = modifier_only THEN c2 ELSE c END,
      'archive-scope-' || replace(u::text, '-', '') || '@example.invalid',
      '#431 explicit-scope check user', false
    );
  END LOOP;

  INSERT INTO public.permissions(key, label, category) VALUES
    ('archive.view', 'View Cold Storage Archives', 'archives'),
    ('archive.view_all', 'View All Cold Storage Archives', 'archives')
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.roles(company_id, name)
  VALUES (c, '#431 explicit-scope viewer') RETURNING id INTO caller_role;
  INSERT INTO public.user_roles(user_id, role_id, company_id)
  VALUES (caller, caller_role, c);
  INSERT INTO public.role_permissions(role_id, permission_id)
  SELECT caller_role, p.id FROM public.permissions p
  WHERE p.key IN ('archive.view', 'archive.view_all')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.roles(company_id, name)
  VALUES (c2, '#431 explicit-scope modifier only') RETURNING id INTO modifier_role;
  INSERT INTO public.user_roles(user_id, role_id, company_id)
  VALUES (modifier_only, modifier_role, c2);
  INSERT INTO public.role_permissions(role_id, permission_id)
  SELECT modifier_role, p.id FROM public.permissions p
  WHERE p.key = 'archive.view_all'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.archives(company_id, entity_type, entity_id, snapshot, metadata, archived_by)
  VALUES (
    c, 'task', gen_random_uuid(),
    jsonb_build_object('task', jsonb_build_object('created_by', creator),
      'assignments', '[]'::jsonb, 'comments', '[]'::jsonb, 'attachments', '[]'::jsonb,
      'history', '[]'::jsonb, 'work_sessions', '[]'::jsonb, 'submissions', '[]'::jsonb),
    jsonb_build_object('title', '#431 company archive'), creator
  ) RETURNING id INTO a_company;

  INSERT INTO public.archives(company_id, entity_type, entity_id, snapshot, metadata, archived_by)
  VALUES (
    c2, 'task', gen_random_uuid(),
    jsonb_build_object('task', jsonb_build_object('created_by', modifier_only),
      'assignments', '[]'::jsonb, 'comments', '[]'::jsonb, 'attachments', '[]'::jsonb,
      'history', '[]'::jsonb, 'work_sessions', '[]'::jsonb, 'submissions', '[]'::jsonb),
    jsonb_build_object('title', '#431 foreign archive'), modifier_only
  ) RETURNING id INTO a_foreign;

  INSERT INTO archive_explicit_scope_ctx
  VALUES (c, c2, caller, modifier_only, creator, a_company, a_foreign);
END;
$fixture$;

SET LOCAL ROLE authenticated;
DO $assertions$
DECLARE
  x archive_explicit_scope_ctx%ROWTYPE;
  got_state text;
BEGIN
  SELECT * INTO x FROM archive_explicit_scope_ctx;
  PERFORM set_config('request.jwt.claim.sub', x.caller_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', x.caller_id, 'role', 'authenticated')::text, true);

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.rpc_get_archives()
    WHERE id = x.company_archive_id
  ), 'omitted p_include_company did not remain principal-scoped';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.rpc_get_archives(NULL, NULL, false)
    WHERE id = x.company_archive_id
  ), 'explicit false p_include_company did not remain principal-scoped';
  ASSERT EXISTS (
    SELECT 1 FROM public.rpc_get_archives(NULL, NULL, true)
    WHERE id = x.company_archive_id
  ), 'authorized company-wide view omitted a same-company archive';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.rpc_get_archives(NULL, NULL, true)
    WHERE id = x.foreign_archive_id
  ), 'authorized company-wide view crossed the company boundary';

  PERFORM set_config('request.jwt.claim.sub', x.modifier_only_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', x.modifier_only_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM 1 FROM public.rpc_get_archives(NULL, NULL, true);
  EXCEPTION WHEN OTHERS THEN
    got_state := SQLSTATE;
  END;
  ASSERT got_state = '42501',
    format('archive.view_all without archive.view was not denied with 42501 (got %s)', got_state);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.rpc_get_archives()
  ), 'archive.view_all without archive.view could use the default reader';
END;
$assertions$;
RESET ROLE;
ROLLBACK;
