-- Issue #414: explicit catalog adoption must materialize a real company copy.
BEGIN;

DO $check$
DECLARE
  v_company_id uuid;
  v_owner_id uuid;
  v_owner_role_id uuid;
  v_owner_assignments integer;
  v_default_pipeline_id uuid;
  v_result jsonb;
  v_replay jsonb;
  v_entry public.platform_catalog_entries%rowtype;
  v_group_count_before integer;
  v_group_count_after integer;
BEGIN
  ASSERT to_regprocedure('public.rpc_adopt_platform_catalog_version(text,integer)') IS NOT NULL,
    'catalog adoption coordinator is missing';
  ASSERT to_regprocedure('public.fn_materialize_catalog_pipeline(uuid,uuid,text,integer,text)') IS NOT NULL,
    'shared pipeline materializer is missing';
  ASSERT to_regprocedure('public.fn_materialize_catalog_notification_rules(uuid,uuid,text,integer)') IS NOT NULL,
    'shared notification materializer is missing';
  ASSERT to_regprocedure('public.fn_materialize_catalog_roles(uuid,uuid,text,integer,text)') IS NOT NULL,
    'shared role materializer is missing';
  ASSERT to_regprocedure('public.fn_materialize_catalog_filehub_folders(uuid,uuid,text,integer)') IS NOT NULL,
    'shared FileHub materializer is missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_adopt_platform_catalog_version(text,integer)', 'EXECUTE'),
    'catalog adoption RPC ACL missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_adopt_platform_catalog_version(text,integer)', 'EXECUTE'),
    'catalog adoption RPC leaked to anon';

  SELECT u.company_id, u.id INTO v_company_id, v_owner_id
    FROM public.users u
   WHERE u.is_owner AND u.is_active
     AND EXISTS (SELECT 1 FROM public.roles r WHERE r.company_id = u.company_id AND r.name = 'Owner' AND r.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.pipelines p WHERE p.company_id = u.company_id AND p.name = 'Main Workflow' AND p.deleted_at IS NULL)
   ORDER BY u.created_at
   LIMIT 1;
  ASSERT v_company_id IS NOT NULL AND v_owner_id IS NOT NULL,
    'upgrade check requires an existing owner-backed company';
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);

  SELECT r.id INTO v_owner_role_id
    FROM public.roles r
   WHERE r.company_id = v_company_id AND r.name = 'Owner' AND r.deleted_at IS NULL
   ORDER BY r.created_at LIMIT 1;
  SELECT count(*) INTO v_owner_assignments
    FROM public.user_roles ur
   WHERE ur.company_id = v_company_id AND ur.role_id = v_owner_role_id AND ur.user_id = v_owner_id AND ur.revoked_at IS NULL;
  SELECT p.id INTO v_default_pipeline_id
    FROM public.pipelines p
   WHERE p.company_id = v_company_id AND p.name = 'Main Workflow' AND p.deleted_at IS NULL
   ORDER BY p.created_at LIMIT 1;
  UPDATE public.pipelines SET description = '__issue414_upgrade_preserves_customization__'
   WHERE id = v_default_pipeline_id;
  SELECT count(*) INTO v_group_count_before FROM public.filehub_groups WHERE company_id = v_company_id;

  -- Publish synthetic semantic v2 snapshots inside this rollback-only check.
  INSERT INTO public.platform_catalog_entries (
    catalog_key, version, kind, owner_scope, classification,
    permission_boundary, customization_policy, update_policy,
    cloneable, editable, replaceable, existing_companies_affected,
    payload, content_hash, baseline_hash, publication_state, lifecycle_state, published_at
  )
  SELECT e.catalog_key, 2, e.kind, e.owner_scope, e.classification,
         e.permission_boundary, e.customization_policy, e.update_policy,
         e.cloneable, e.editable, e.replaceable, e.existing_companies_affected,
         e.payload || '{"schema_version":2}'::jsonb, '', '', 'published', 'published', now()
    FROM public.platform_catalog_entries e
   WHERE e.catalog_key IN (
     'roles_permissions', 'task_workflow.standard', 'notification_rules.standard',
     'filehub_system_folders.standard', 'project_template.monthly-bookkeeping-close'
   )
     AND e.version = 1;
  UPDATE public.platform_catalog_heads
     SET recommended_version = 2, published_version = 2, updated_at = now()
   WHERE catalog_key IN (
     'roles_permissions', 'task_workflow.standard', 'notification_rules.standard',
     'filehub_system_folders.standard', 'project_template.monthly-bookkeeping-close'
   );

  SELECT e.* INTO v_entry FROM public.platform_catalog_entries e
   WHERE e.catalog_key = 'task_workflow.standard' AND e.version = 2;
  INSERT INTO public.company_catalog_installations (
    company_id, catalog_key, catalog_version, baseline_hash, idempotency_key,
    materialized_refs, materialized_references, creation_path, selected_by
  ) VALUES (
    v_company_id, 'task_workflow.standard', 2, v_entry.content_hash,
    'legacy-empty-upgrade-check', '{}', '{}', 'legacy-check', v_owner_id
  );

  SELECT public.rpc_adopt_platform_catalog_version('roles_permissions', 2) INTO v_result;
  ASSERT (v_result->'materialized_refs') <> '{}'::jsonb, 'role upgrade returned empty references';
  ASSERT (SELECT count(*) FROM public.roles WHERE company_id = v_company_id AND name LIKE '%(Catalog v2)') = 4,
    'role upgrade did not create four company-owned copies';
  ASSERT (SELECT count(*) FROM public.user_roles ur WHERE ur.company_id = v_company_id AND ur.role_id = v_owner_role_id AND ur.user_id = v_owner_id AND ur.revoked_at IS NULL) = v_owner_assignments,
    'role upgrade changed Owner assignment';

  SELECT public.rpc_adopt_platform_catalog_version('task_workflow.standard', 2) INTO v_result;
  ASSERT (v_result->'materialized_refs') <> '{}'::jsonb, 'workflow upgrade returned empty references';
  ASSERT (SELECT count(*) FROM public.pipelines WHERE company_id = v_company_id AND name = 'Main Workflow (Catalog v2)' AND deleted_at IS NULL) = 1,
    'workflow upgrade did not create one separate pipeline';
  ASSERT (SELECT is_default FROM public.pipelines WHERE id = (v_result->'materialized_refs'->>'pipeline_id')::uuid) = false,
    'workflow upgrade switched the default pipeline';
  ASSERT (SELECT description FROM public.pipelines WHERE id = v_default_pipeline_id) = '__issue414_upgrade_preserves_customization__',
    'workflow upgrade overwrote the customized v1 pipeline';
  SELECT public.rpc_adopt_platform_catalog_version('task_workflow.standard', 2) INTO v_replay;
  ASSERT v_replay->>'installation_id' = v_result->>'installation_id', 'workflow replay changed installation';
  ASSERT v_replay->'materialized_refs' = v_result->'materialized_refs', 'workflow replay changed references';
  ASSERT (SELECT count(*) FROM public.pipelines WHERE company_id = v_company_id AND name = 'Main Workflow (Catalog v2)' AND deleted_at IS NULL) = 1,
    'workflow replay created a duplicate pipeline';

  SELECT public.rpc_adopt_platform_catalog_version('notification_rules.standard', 2) INTO v_result;
  ASSERT jsonb_array_length(v_result->'materialized_refs'->'rule_ids') >= 1,
    'notification upgrade did not create company-owned rules';
  SELECT public.rpc_adopt_platform_catalog_version('filehub_system_folders.standard', 2) INTO v_result;
  ASSERT (SELECT count(*) FROM jsonb_object_keys(v_result->'materialized_refs'->'folder_ids')) = 2,
    'FileHub upgrade did not materialize both system roots';
  SELECT count(*) INTO v_group_count_after FROM public.filehub_groups WHERE company_id = v_company_id;
  ASSERT v_group_count_after = v_group_count_before,
    'FileHub upgrade changed channel/group rows';

  SELECT public.rpc_adopt_platform_catalog_version('project_template.monthly-bookkeeping-close', 2) INTO v_result;
  ASSERT (v_result->'materialized_refs'->>'template_id') IS NOT NULL,
    'starter upgrade did not return a materialized template';
  ASSERT (SELECT catalog_version FROM public.project_templates WHERE id = (v_result->'materialized_refs'->>'template_id')::uuid) = 2,
    'starter upgrade did not annotate the company template version';
  ASSERT (SELECT count(*) FROM public.company_catalog_installations
           WHERE company_id = v_company_id AND catalog_key = 'task_workflow.standard' AND catalog_version = 2) = 1,
    'empty legacy workflow installation was not repaired';

  RAISE NOTICE 'check_catalog_upgrade_materialization: contract passed';
END;
$check$;

ROLLBACK;
