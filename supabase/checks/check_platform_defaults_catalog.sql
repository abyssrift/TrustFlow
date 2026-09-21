-- Issue #414 Task 1: catalog foundation contract.
BEGIN;

DO $check$
DECLARE
  v_company_id uuid;
  v_owner_id uuid;
  v_entry public.platform_catalog_entries%rowtype;
  v_install_id uuid;
  v_second_id uuid;
  v_failed boolean;
BEGIN
  ASSERT to_regclass('public.platform_catalog_entries') IS NOT NULL, 'catalog entries table is missing';
  ASSERT to_regclass('public.platform_catalog_heads') IS NOT NULL, 'catalog heads table is missing';
  ASSERT to_regclass('public.company_catalog_installations') IS NOT NULL, 'company installation ledger is missing';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_platform_catalog_entries_key_version'), 'catalog version index missing';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_company_catalog_installations_company_key'), 'tenant catalog index missing';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_company_catalog_installations_key_version'), 'catalog lookup index missing';
  ASSERT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_heads_recommended_fk'), 'recommended head foreign key missing';
  ASSERT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_heads_published_fk'), 'published head foreign key missing';
  ASSERT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.company_catalog_installations'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%catalog_version > 0%'
  ), 'installation version check missing';
  ASSERT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_catalog_installations_state_check'), 'installation state check missing';
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'platform_catalog_entries' AND policyname = 'platform_catalog_entries_read'), 'entry RLS policy missing';
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_catalog_installations' AND policyname = 'company_catalog_installations_read'), 'installation RLS policy missing';
  ASSERT has_table_privilege('authenticated', 'public.platform_catalog_entries', 'SELECT'), 'authenticated entry ACL missing';
  ASSERT NOT has_table_privilege('anon', 'public.platform_catalog_entries', 'SELECT'), 'anon entry ACL leaked';
  ASSERT has_function_privilege('authenticated', 'public.rpc_install_platform_default_catalog(text,integer)', 'EXECUTE'), 'install RPC ACL missing';
  ASSERT NOT has_function_privilege('public', 'public.rpc_install_platform_default_catalog(text,integer)', 'EXECUTE'), 'install RPC remains executable by PUBLIC';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_install_platform_default_catalog(text,integer)', 'EXECUTE'), 'install RPC remains executable by anon';
  ASSERT has_function_privilege('authenticated', 'public.rpc_create_company_and_link(text,text)', 'EXECUTE'), 'company creation wrapper ACL missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_create_company_and_link(text,text)', 'EXECUTE'), 'company creation wrapper remains executable by anon';
  ASSERT NOT has_function_privilege('authenticated', 'public.fn_seed_company_default_roles(uuid)', 'EXECUTE'), 'company role seeder is exposed to authenticated users';

  SELECT * INTO v_entry
    FROM public.platform_catalog_entries
   WHERE catalog_key = 'roles_permissions'
     AND version = 1;
  ASSERT v_entry.catalog_key IS NOT NULL, 'roles_permissions v1 seed is missing';
  ASSERT v_entry.kind = 'role_bundle', 'roles_permissions v1 kind is wrong';
  ASSERT v_entry.owner_scope = 'platform', 'roles_permissions v1 owner scope is wrong';
  ASSERT v_entry.classification = 'platform_curated_default', 'roles_permissions v1 classification is wrong';
  ASSERT v_entry.permission_boundary = 'platform', 'roles_permissions v1 permission boundary is wrong';
  ASSERT v_entry.cloneable AND NOT v_entry.editable AND NOT v_entry.replaceable, 'roles_permissions v1 customization policy is wrong';
  ASSERT NOT v_entry.existing_companies_affected, 'roles_permissions v1 may not affect existing companies';
  ASSERT v_entry.baseline_hash = v_entry.content_hash, 'baseline hash is unstable';
  ASSERT v_entry.creation_path = 'migration', 'seed creation path is wrong';
  ASSERT NOT public._catalog_payload_has_uuid(v_entry.payload), 'catalog payload contains a UUID key or value';
  ASSERT (v_entry.payload->>'schema_version') = '1', 'catalog payload schema version missing';
  ASSERT EXISTS (
    SELECT 1 FROM public.platform_catalog_heads h
     WHERE h.catalog_key = 'roles_permissions'
       AND h.recommended_version = 1
       AND h.published_version = 1
  ), 'published recommended head is missing';

  -- Same key/version with the same semantic payload is a migration replay;
  -- changing that version's payload is forbidden.
  INSERT INTO public.platform_catalog_entries (
    catalog_key, version, kind, payload, content_hash, baseline_hash
  ) VALUES (
    'roles_permissions', 1, 'role_bundle', v_entry.payload, '', ''
  );
  v_failed := false;
  BEGIN
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, payload, content_hash, baseline_hash
    ) VALUES ('roles_permissions', 1, 'role_bundle', '{"changed":true}', '', '');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%different payload%', 'different replay has wrong error';
  END;
  ASSERT v_failed, 'different replay unexpectedly succeeded';

  v_failed := false;
  BEGIN
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, payload, content_hash, baseline_hash
    ) VALUES ('roles_permissions', 0, 'role_bundle', '{"old":true}', '', '');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%monotonically%', 'non-monotonic version has wrong error';
  END;
  ASSERT v_failed, 'non-monotonic version unexpectedly succeeded';

  v_failed := false;
  BEGIN
    UPDATE public.platform_catalog_entries SET payload = '{"changed":true}'
     WHERE catalog_key = v_entry.catalog_key AND version = v_entry.version;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%immutable%', 'immutable guard has wrong error';
  END;
  ASSERT v_failed, 'immutable entry update unexpectedly succeeded';

  v_failed := false;
  BEGIN
    PERFORM public.rpc_resolve_published_catalog_entry('roles_permissions', 999999);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%not published%', 'unpublished resolver has wrong error';
  END;
  ASSERT v_failed, 'unpublished explicit version unexpectedly resolved';

  SELECT c.id INTO v_company_id FROM public.companies c LIMIT 1;
  SELECT u.id INTO v_owner_id
    FROM public.users u
   WHERE u.company_id = v_company_id
     AND u.is_owner
   LIMIT 1;
  IF v_company_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
    SELECT public.rpc_install_platform_default_catalog('roles_permissions', 1) INTO v_install_id;
    SELECT public.rpc_install_platform_default_catalog('roles_permissions', 1) INTO v_second_id;
    ASSERT v_install_id = v_second_id, 'exact installation replay was not idempotent';
    ASSERT (SELECT count(*) FROM public.company_catalog_installations i
             WHERE i.company_id = v_company_id
               AND i.catalog_key = 'roles_permissions'
               AND i.catalog_version = 1) = 1, 'exact installation replay duplicated the ledger';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.rpc_install_platform_default_catalog('roles_permissions', 1);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%authorized%', 'unauthorized install has wrong error';
  END;
  ASSERT v_failed, 'unauthorized install unexpectedly succeeded';

  RAISE NOTICE 'check_platform_defaults_catalog: contract passed';
END;
$check$;

ROLLBACK;
