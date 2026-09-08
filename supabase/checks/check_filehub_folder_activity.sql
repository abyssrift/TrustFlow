-- Deterministic disposable check for rpc_filehub_folder_activity (#334).
-- Run only against a disposable/local database. Every fixture is UUID-tagged
-- and the transaction is rolled back. Apply migrations through the PR reader.

BEGIN;
SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  c1 CONSTANT UUID := '33400000-0000-0000-0000-000000000001';
  c2 CONSTANT UUID := '33400000-0000-0000-0000-000000000002';
  owner_id CONSTANT UUID := '33400000-0000-0000-0000-000000000011';
  member_id CONSTANT UUID := '33400000-0000-0000-0000-000000000012';
  outsider_id CONSTANT UUID := '33400000-0000-0000-0000-000000000013';
  owned_folder CONSTANT UUID := '33400000-0000-0000-0000-000000000101';
  private_folder CONSTANT UUID := '33400000-0000-0000-0000-000000000102';
  empty_folder CONSTANT UUID := '33400000-0000-0000-0000-000000000103';
  foreign_folder CONSTANT UUID := '33400000-0000-0000-0000-000000000201';
  activity_old CONSTANT UUID := '33400000-0000-0000-0000-000000000301';
  activity_new CONSTANT UUID := '33400000-0000-0000-0000-000000000302';
  fixture_permission CONSTANT UUID := '33400000-0000-0000-0000-000000000401';
  fixture_role CONSTANT UUID := '33400000-0000-0000-0000-000000000402';
  marker CONSTANT TEXT := '334-folder-activity-check';
  permission_id UUID;
  rows JSONB; row JSONB; before_count BIGINT; after_count BIGINT; denied BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (owner_id, marker || '-owner@test.invalid'),
    (member_id, marker || '-member@test.invalid'),
    (outsider_id, marker || '-outsider@test.invalid');
  INSERT INTO public.companies (id, name, slug) VALUES
    (c1, marker || ' company 1', marker || '-company-1'),
    (c2, marker || ' company 2', marker || '-company-2');
  INSERT INTO public.users (id, company_id, email, full_name, is_owner, is_active) VALUES
    (owner_id, c1, marker || '-owner@test.invalid', 'Check Authorized Nonowner', false, true),
    (member_id, c1, marker || '-member@test.invalid', 'Check Member', false, true),
    (outsider_id, c2, marker || '-outsider@test.invalid', 'Check Outsider', true, true);
  INSERT INTO public.permissions (id, key, label, category)
  VALUES (fixture_permission, marker || ':fixture', 'Folder activity check fixture', 'filehub');
  SELECT id INTO permission_id FROM public.permissions WHERE key = 'filehub:view' LIMIT 1;
  ASSERT permission_id IS NOT NULL, 'filehub:view permission is missing from current definitions';
  INSERT INTO public.roles (id, company_id, name, is_system, is_default)
  VALUES (fixture_role, c1, marker || ' role', false, false);
  INSERT INTO public.role_permissions (role_id, permission_id)
  VALUES (fixture_role, permission_id), (fixture_role, fixture_permission);
  INSERT INTO public.user_roles (user_id, role_id, company_id) VALUES (owner_id, fixture_role, c1);

  INSERT INTO public.filehub_folders (id, company_id, name, created_by, scope) VALUES
    (owned_folder, c1, marker || ' owned', owner_id, 'direct'),
    (private_folder, c1, marker || ' private', member_id, 'direct'),
    (empty_folder, c1, marker || ' empty', owner_id, 'direct'),
    (foreign_folder, c2, marker || ' foreign', outsider_id, 'direct');
  INSERT INTO public.filehub_activity (id, company_id, file_id, folder_id, user_id, action, metadata, created_at) VALUES
    (activity_old, c1, NULL, owned_folder, owner_id, 'share', jsonb_build_object('marker', marker, 'n', 1), now() - interval '2 minutes'),
    (activity_new, c1, NULL, owned_folder, owner_id, 'download', jsonb_build_object('marker', marker, 'n', 2), now() - interval '1 minute');

  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  denied := false;
  BEGIN PERFORM public.rpc_filehub_folder_activity(owned_folder); EXCEPTION WHEN OTHERS THEN denied := true; END;
  ASSERT denied, 'null auth was not denied';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', member_id::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  denied := false;
  BEGIN PERFORM public.rpc_filehub_folder_activity(owned_folder); EXCEPTION WHEN OTHERS THEN denied := true; END;
  ASSERT denied, 'authenticated user lacking filehub:view was not denied';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  ASSERT public.rpc_filehub_folder_activity(private_folder) = '[]'::jsonb, 'same-tenant inaccessible folder leaked';
  ASSERT public.rpc_filehub_folder_activity(foreign_folder) = '[]'::jsonb, 'wrong-tenant folder leaked';
  rows := public.rpc_filehub_folder_activity(owned_folder);
  ASSERT jsonb_array_length(rows) = 2, 'authorized populated result row count changed';
  row := rows -> 0;
  ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row) k) = ARRAY['action','created_at','id','metadata','user'], 'top-level JSON keys changed';
  ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row->'user') k) = ARRAY['avatar_url','full_name','id'], 'user JSON keys changed';
  ASSERT row->>'id' = activity_new::text AND row->>'action' = 'download', 'newest-first ordering changed';
  ASSERT row->'metadata'->>'marker' = marker AND (rows -> 1)->>'id' = activity_old::text, 'activity payload changed';
  ASSERT public.rpc_filehub_folder_activity(empty_folder) = '[]'::jsonb, 'authorized empty folder did not return []';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.rpc_filehub_folder_activity(uuid)'::regprocedure
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ), 'EXECUTE remains granted to PUBLIC';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_filehub_folder_activity(uuid)', 'EXECUTE'), 'EXECUTE remains granted to anon';
  ASSERT has_function_privilege('authenticated', 'public.rpc_filehub_folder_activity(uuid)', 'EXECUTE'), 'EXECUTE is not granted to authenticated';
  SELECT count(*) INTO before_count FROM public.filehub_activity WHERE folder_id = owned_folder AND action = 'view';
  PERFORM public.rpc_filehub_folder_activity(owned_folder);
  SELECT count(*) INTO after_count FROM public.filehub_activity WHERE folder_id = owned_folder AND action = 'view';
  ASSERT after_count = before_count, 'folder reader created a view activity row';
END;
$check$;

ROLLBACK;

-- Execute this block separately (and optionally in a fresh psql session) to
-- prove no UUID-tagged fixture survived in any touched table.
DO $rollback_check$
DECLARE remaining_rows BIGINT;
BEGIN
  SELECT
    (SELECT count(*) FROM auth.users WHERE id IN ('33400000-0000-0000-0000-000000000011'::uuid, '33400000-0000-0000-0000-000000000012'::uuid, '33400000-0000-0000-0000-000000000013'::uuid)) +
    (SELECT count(*) FROM public.users WHERE id IN ('33400000-0000-0000-0000-000000000011'::uuid, '33400000-0000-0000-0000-000000000012'::uuid, '33400000-0000-0000-0000-000000000013'::uuid)) +
    (SELECT count(*) FROM public.companies WHERE id IN ('33400000-0000-0000-0000-000000000001'::uuid, '33400000-0000-0000-0000-000000000002'::uuid)) +
    (SELECT count(*) FROM public.permissions WHERE id = '33400000-0000-0000-0000-000000000401'::uuid) +
    (SELECT count(*) FROM public.roles WHERE id = '33400000-0000-0000-0000-000000000402'::uuid) +
    (SELECT count(*) FROM public.role_permissions WHERE role_id = '33400000-0000-0000-0000-000000000402'::uuid) +
    (SELECT count(*) FROM public.user_roles WHERE user_id IN ('33400000-0000-0000-0000-000000000011'::uuid, '33400000-0000-0000-0000-000000000012'::uuid, '33400000-0000-0000-0000-000000000013'::uuid)) +
    (SELECT count(*) FROM public.filehub_folders WHERE id IN ('33400000-0000-0000-0000-000000000101'::uuid, '33400000-0000-0000-0000-000000000102'::uuid, '33400000-0000-0000-0000-000000000103'::uuid, '33400000-0000-0000-0000-000000000201'::uuid)) +
    (SELECT count(*) FROM public.filehub_activity WHERE id IN ('33400000-0000-0000-0000-000000000301'::uuid, '33400000-0000-0000-0000-000000000302'::uuid))
  INTO remaining_rows;
  ASSERT remaining_rows = 0, format('rollback left %s UUID-tagged fixture rows', remaining_rows);
END;
$rollback_check$;
