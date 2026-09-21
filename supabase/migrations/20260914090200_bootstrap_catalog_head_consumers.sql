-- Fresh bootstrap must record and consume the published catalog head, not a
-- version literal copied from the first catalog migration.

CREATE OR REPLACE FUNCTION public.fn_seed_company_default_roles(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payload jsonb;
  v_catalog_version integer;
  v_role jsonb;
  v_role_id uuid;
  v_role_ids jsonb := '{}'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('roles:' || p_company_id::text, 414));
  IF EXISTS (SELECT 1 FROM public.roles r WHERE r.company_id = p_company_id) THEN
    RETURN;
  END IF;

  SELECT e.payload, e.version
    INTO v_payload, v_catalog_version
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = 'roles_permissions'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'roles_permissions catalog entry is not published';
  END IF;

  FOR v_role IN SELECT value FROM jsonb_array_elements(v_payload->'roles') AS item(value)
  LOOP
    INSERT INTO public.roles (
      company_id, name, description, color, is_system, is_default
    ) VALUES (
      p_company_id, v_role->>'name', v_role->>'description', v_role->>'color',
      false, COALESCE((v_role->>'is_default')::boolean, false)
    )
    ON CONFLICT (company_id, lower(name)) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id INTO v_role_id;

    IF v_role_id IS NULL THEN
      SELECT r.id INTO v_role_id
        FROM public.roles r
       WHERE r.company_id = p_company_id
         AND lower(r.name) = lower(v_role->>'name')
         AND r.deleted_at IS NULL;
    END IF;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role_id, p.id
      FROM public.permissions p
     WHERE p.key IN (SELECT value FROM jsonb_array_elements_text(v_role->'permission_keys'))
    ON CONFLICT DO NOTHING;
    v_role_ids := v_role_ids || jsonb_build_object(v_role->>'name', v_role_id);
    v_role_id := NULL;
  END LOOP;

  PERFORM public.fn_record_company_catalog_installation(
    p_company_id, 'roles_permissions', v_catalog_version,
    jsonb_build_object('role_ids', v_role_ids), 'company-bootstrap', NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_bootstrap_company_defaults_core(
  p_company_id uuid,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.platform_catalog_entries;
  v_pipeline_id uuid;
  v_refs jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bootstrap:' || p_company_id::text, 414));
  PERFORM public.fn_seed_company_default_roles(p_company_id);

  SELECT e.* INTO v_entry
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = 'task_workflow.standard'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_workflow.standard catalog entry is not published';
  END IF;

  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.company_id = p_company_id
     AND p.name = v_entry.payload->>'name'
     AND p.deleted_at IS NULL
   ORDER BY p.created_at
   LIMIT 1;

  IF v_pipeline_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipelines p
     WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
  ) THEN
    v_refs := public.fn_materialize_catalog_pipeline(
      p_company_id, p_created_by, v_entry.catalog_key, v_entry.version, NULL
    );
    v_pipeline_id := (v_refs->>'pipeline_id')::uuid;
  ELSE
    v_refs := jsonb_build_object('pipeline_id', v_pipeline_id);
  END IF;

  IF v_pipeline_id IS NOT NULL THEN
    PERFORM public.fn_record_company_catalog_installation(
      p_company_id, v_entry.catalog_key, v_entry.version,
      v_refs, 'company-bootstrap', p_created_by
    );
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'roles_catalog_key', 'roles_permissions',
    'workflow_catalog_key', v_entry.catalog_key,
    'workflow_catalog_version', v_entry.version,
    'pipeline_id', v_pipeline_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_bootstrap_company_defaults_core(uuid,uuid) FROM PUBLIC, anon, authenticated;
