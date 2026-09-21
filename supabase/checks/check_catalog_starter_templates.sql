-- Issue #414 Task 3: catalog-backed starter/template contract.
BEGIN;

DO $check$
DECLARE
  v_company_id uuid;
  v_owner_id uuid;
  v_template public.project_templates%rowtype;
  v_second public.project_templates%rowtype;
BEGIN
  ASSERT to_regprocedure('public.rpc_create_catalog_starter_template(text,integer)') IS NOT NULL,
    'catalog starter RPC missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_create_catalog_starter_template(text,integer)', 'EXECUTE'),
    'catalog starter RPC ACL missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_create_catalog_starter_template(text,integer)', 'EXECUTE'),
    'catalog starter RPC leaked to anon';
  ASSERT (SELECT count(*) FROM public.platform_catalog_entries WHERE kind = 'project_template') >= 3,
    'recommended project template presets are missing';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.platform_catalog_entries e
     WHERE e.kind = 'project_template'
       AND (public._catalog_payload_has_uuid(e.payload)
         OR e.payload::text ~ 'pipeline_id|assignee_team_id')
  ), 'project starter payload contains tenant-specific identifiers';

  SELECT c.id INTO v_company_id FROM public.companies c LIMIT 1;
  SELECT u.id INTO v_owner_id
    FROM public.users u
   WHERE u.company_id = v_company_id
     AND u.is_owner
   LIMIT 1;
  IF v_company_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
    SELECT * INTO v_template
      FROM public.rpc_create_catalog_starter_template('project_template.monthly-bookkeeping-close', 1);
    SELECT * INTO v_second
      FROM public.rpc_create_catalog_starter_template('project_template.monthly-bookkeeping-close', 1);
    ASSERT v_template.id IS NOT NULL AND v_second.id IS NOT NULL AND v_template.id <> v_second.id,
      'each explicit starter selection must create an editable company copy';
    ASSERT (SELECT jsonb_array_length(body) FROM public.project_templates WHERE id = v_template.id) = 12,
      'materialized starter body is not the catalog body';
    ASSERT (SELECT count(*) FROM public.company_catalog_installations
             WHERE company_id = v_company_id
               AND catalog_key = 'project_template.monthly-bookkeeping-close'
               AND catalog_version = 1) = 1,
      'starter installation provenance is not idempotent';
  END IF;

  RAISE NOTICE 'check_catalog_starter_templates: contract passed';
END;
$check$;

ROLLBACK;
