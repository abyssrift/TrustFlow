-- Issue #414 Task 6: FileHub system-folder contract.
BEGIN;

DO $check$
DECLARE
  v_company_id uuid;
  v_owner_id uuid;
  v_portfolio_id uuid;
  v_portfolio_retry uuid;
  v_client_id uuid;
  v_folder_before integer;
  v_folder_after integer;
  v_group_before integer;
  v_group_after integer;
BEGIN
  ASSERT to_regprocedure('public.rpc_filehub_get_system_folder(text,text,uuid)') IS NOT NULL,
    'system-folder RPC missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_filehub_get_system_folder(text,text,uuid)', 'EXECUTE'),
    'system-folder RPC ACL missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_filehub_get_system_folder(text,text,uuid)', 'EXECUTE'),
    'system-folder RPC leaked to anon';
  ASSERT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
      JOIN public.platform_catalog_heads h
        ON h.catalog_key = e.catalog_key
       AND h.published_version = e.version
     WHERE e.catalog_key = 'filehub_system_folders.standard'
       AND e.kind = 'filehub_system_folder'
       AND e.payload->'folders' IS NOT NULL
  ), 'FileHub system-folder catalog entry is missing';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE e.catalog_key = 'filehub_system_folders.standard'
       AND (public._catalog_payload_has_uuid(e.payload)
         OR e.payload::text ~ 'group_id|channel_id|company_id|user_id')
  ), 'FileHub catalog payload contains tenant-specific identifiers';

  SELECT c.id INTO v_company_id FROM public.companies c LIMIT 1;
  SELECT u.id INTO v_owner_id
    FROM public.users u
   WHERE u.company_id = v_company_id
     AND u.is_owner
   LIMIT 1;

  IF v_company_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);

    SELECT count(*) INTO v_folder_before
      FROM public.filehub_folders
     WHERE company_id = v_company_id
       AND name = 'Portfolio Imports'
       AND scope = 'broadcast'
       AND parent_id IS NULL
       AND deleted_at IS NULL;
    SELECT count(*) INTO v_group_before
      FROM public.filehub_groups
     WHERE company_id = v_company_id;

    SELECT public.rpc_filehub_get_system_folder('Portfolio Imports', 'broadcast', NULL)
      INTO v_portfolio_id;
    SELECT public.rpc_filehub_get_system_folder('Portfolio Imports', 'broadcast', NULL)
      INTO v_portfolio_retry;
    SELECT public.rpc_filehub_get_system_folder('Client Files', 'broadcast', NULL)
      INTO v_client_id;

    ASSERT v_portfolio_id IS NOT NULL AND v_portfolio_id = v_portfolio_retry,
      'system-folder retry did not reuse the existing folder';
    ASSERT v_client_id IS NOT NULL AND v_client_id <> v_portfolio_id,
      'system folders are not independently materialized';
    SELECT count(*) INTO v_folder_after
      FROM public.filehub_folders
     WHERE company_id = v_company_id
       AND scope = 'broadcast'
       AND parent_id IS NULL
       AND deleted_at IS NULL
       AND name IN ('Portfolio Imports', 'Client Files');
    ASSERT v_folder_after <= v_folder_before + 2,
      'system-folder materialization created unexpected duplicates';
    ASSERT (SELECT count(*) FROM public.filehub_folders WHERE id = v_portfolio_id) = 1,
      'Portfolio Imports folder was not created';
    ASSERT (SELECT count(*) FROM public.filehub_folders WHERE id = v_client_id) = 1,
      'Client Files folder was not created';
    SELECT count(*) INTO v_group_after FROM public.filehub_groups WHERE company_id = v_company_id;
    ASSERT v_group_after = v_group_before,
      'system-folder materialization created a FileHub channel';
    ASSERT (SELECT count(*)
              FROM public.company_catalog_installations
             WHERE company_id = v_company_id
               AND catalog_key = 'filehub_system_folders.standard'
               AND catalog_version = 1) = 1,
      'system-folder installation provenance is not idempotent';
  END IF;

  RAISE NOTICE 'check_filehub_system_folders: contract passed';
END;
$check$;

ROLLBACK;
