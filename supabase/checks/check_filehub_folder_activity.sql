-- Rollback-only check for rpc_filehub_folder_activity (#334).
-- Run against a seeded disposable/dev database, never production. The fixture
-- reuses existing users/folders and inserts one throwaway folder event.
-- Trigger execution is suppressed for this transaction because repository
-- notification triggers can dispatch pg_net; the transaction always rolls back.
BEGIN;
SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_user UUID;
  v_company UUID;
  v_folder UUID;
  v_other_company_folder UUID;
  v_inaccessible_folder UUID;
  v_event UUID;
  v_rows JSONB;
  v_row JSONB;
BEGIN
  SELECT id, company_id INTO v_user, v_company
  FROM public.users WHERE is_owner = true LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'No owner user found -- use a seeded disposable database'; END IF;

  SELECT id INTO v_folder
  FROM public.filehub_folders
  WHERE company_id = v_company AND deleted_at IS NULL AND created_by = v_user
  ORDER BY created_at LIMIT 1;
  IF v_folder IS NULL THEN RAISE EXCEPTION 'Owner has no live FileHub folder fixture'; END IF;

  SELECT f.id INTO v_inaccessible_folder
  FROM public.filehub_folders f
  WHERE f.company_id = v_company AND f.deleted_at IS NULL
    AND f.scope = 'direct' AND f.created_by <> v_user
  LIMIT 1;
  IF v_inaccessible_folder IS NULL THEN
    RAISE EXCEPTION 'No same-company inaccessible direct folder fixture';
  END IF;

  SELECT id INTO v_other_company_folder
  FROM public.filehub_folders WHERE company_id <> v_company AND deleted_at IS NULL LIMIT 1;
  IF v_other_company_folder IS NULL THEN RAISE EXCEPTION 'No cross-tenant folder fixture'; END IF;

  INSERT INTO public.filehub_activity(company_id, folder_id, user_id, action, metadata)
  VALUES (v_company, v_folder, v_user, 'share', jsonb_build_object('check', true))
  RETURNING id INTO v_event;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  IF NOT has_function_privilege('authenticated', 'public.rpc_filehub_folder_activity(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_filehub_folder_activity(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_filehub_folder_activity grants are not restricted to authenticated';
  END IF;

  v_rows := public.rpc_filehub_folder_activity(v_folder);
  ASSERT jsonb_typeof(v_rows) = 'array', 'authorized result must be a JSON array';
  ASSERT jsonb_array_length(v_rows) >= 1, 'authorized folder activity must include fixture';
  v_row := v_rows -> 0;
  ASSERT v_row ?& ARRAY['id','action','metadata','created_at','user'], 'activity row shape changed';
  ASSERT v_row->>'id' = v_event::text, 'newest activity row is not returned first';
  ASSERT v_row->>'action' = 'share', 'activity action shape changed';
  ASSERT (v_row->'user') ?& ARRAY['id','full_name','avatar_url'], 'user shape changed';

  ASSERT public.rpc_filehub_folder_activity(v_inaccessible_folder) = '[]'::jsonb,
    'same-company inaccessible folder leaked activity';
  ASSERT public.rpc_filehub_folder_activity(v_other_company_folder) = '[]'::jsonb,
    'cross-tenant folder leaked activity';
END $check$;

ROLLBACK;
