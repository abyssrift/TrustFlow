-- Issue #414 Task 2: deterministic fresh-company bootstrap.
--
-- This migration makes the published catalog the source for the role bundle
-- and the standard task workflow. Tenant IDs are introduced only while this
-- SECURITY DEFINER materializer creates company-owned rows. Retries use
-- advisory locks and unique keys; they never update an existing default.

DO $catalog$
DECLARE
  v_payload jsonb := $task_workflow_payload${"schema_version":1,"name":"Main Workflow","description":"Default pipeline for your workspace","kind":"task_workflow","subject_kind":"task","is_default":true,"stages":[{"key":"backlog","name":"Backlog","color":"#6B7280","position":1,"is_initial":true,"is_terminal":false,"terminal_type":null,"requires_submission":false,"submission_mode":"none"},{"key":"in_progress","name":"In Progress","color":"#3B82F6","position":2,"is_initial":false,"is_terminal":false,"terminal_type":null,"requires_submission":false,"submission_mode":"none"},{"key":"in_review","name":"In Review","color":"#F59E0B","position":3,"is_initial":false,"is_terminal":false,"terminal_type":null,"requires_submission":true,"submission_mode":"required"},{"key":"done","name":"Done","color":"#10B981","position":4,"is_initial":false,"is_terminal":true,"terminal_type":"success","requires_submission":false,"submission_mode":"none"}],"transitions":[{"from":"backlog","to":"in_progress","label":"Start Work","transition_type":"neutral"},{"from":"in_progress","to":"in_review","label":"Submit for Review","transition_type":"neutral"},{"from":"in_review","to":"done","label":"Approve","transition_type":"neutral"},{"from":"in_review","to":"in_progress","label":"Request Revision","transition_type":"neutral"}],"actions":[{"from":"backlog","to":"in_progress","action_type":"advance","label":"Start Work","style":"primary","required_role":"any","position":1},{"from":"in_progress","to":"in_review","action_type":"advance","label":"Submit for Review","style":"primary","required_role":"any","position":1},{"from":"in_review","to":"done","action_type":"advance","label":"Approve","style":"primary","required_role":"any","position":1},{"from":"in_review","to":"in_progress","action_type":"advance","label":"Request Revision","style":"primary","required_role":"any","position":2}]}$task_workflow_payload$::jsonb;
  v_existing public.platform_catalog_entries%rowtype;
BEGIN
  SELECT * INTO v_existing
    FROM public.platform_catalog_entries
   WHERE catalog_key = 'task_workflow.standard'
     AND version = 1;

  IF v_existing.catalog_key IS NULL THEN
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, owner_scope, classification,
      permission_boundary, customization_policy, update_policy,
      cloneable, editable, replaceable, existing_companies_affected,
      payload, content_hash, baseline_hash, publication_state, retired_at,
      lifecycle_state, published_at
    ) VALUES (
      'task_workflow.standard', 1, 'task_workflow', 'platform',
      'platform_curated_default', 'company', 'clone-to-company',
      'append-only-explicit-upgrade', true, false, false, false,
      v_payload, '', '', 'published', NULL, 'published', now()
    );
  ELSIF v_existing.payload <> v_payload THEN
    RAISE EXCEPTION 'task_workflow.standard v1 replay differs; refusing overwrite';
  END IF;

  INSERT INTO public.platform_catalog_heads (
    catalog_key, recommended_version, published_version
  ) VALUES ('task_workflow.standard', 1, 1)
  ON CONFLICT (catalog_key) DO NOTHING;
  UPDATE public.platform_catalog_heads
     SET published_version = 1,
         updated_at = now()
   WHERE catalog_key = 'task_workflow.standard'
     AND recommended_version = 1
     AND published_version IS NULL;
END;
$catalog$;

CREATE OR REPLACE FUNCTION public.fn_record_company_catalog_installation(
  p_company_id uuid,
  p_catalog_key text,
  p_catalog_version integer,
  p_materialized_refs jsonb,
  p_creation_path text,
  p_selected_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_baseline_hash text;
  v_id uuid;
BEGIN
  SELECT e.content_hash INTO v_baseline_hash
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = p_catalog_key
     AND e.version = p_catalog_version
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF v_baseline_hash IS NULL THEN
    RAISE EXCEPTION 'cannot install an unpublished catalog version';
  END IF;

  INSERT INTO public.company_catalog_installations (
    company_id, catalog_key, catalog_version, baseline_hash,
    idempotency_key, materialized_refs, materialized_references,
    creation_path, selected_by
  ) VALUES (
    p_company_id, p_catalog_key, p_catalog_version, v_baseline_hash,
    p_creation_path || ':' || p_catalog_key || ':v' || p_catalog_version,
    COALESCE(p_materialized_refs, '{}'::jsonb),
    COALESCE(p_materialized_refs, '{}'::jsonb),
    p_creation_path, p_selected_by
  )
  ON CONFLICT (company_id, catalog_key, catalog_version) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT i.id INTO v_id
      FROM public.company_catalog_installations i
     WHERE i.company_id = p_company_id
       AND i.catalog_key = p_catalog_key
       AND i.catalog_version = p_catalog_version
     ORDER BY i.installed_at
     LIMIT 1;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_seed_company_default_roles(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payload jsonb;
  v_role jsonb;
  v_role_id uuid;
  v_role_ids jsonb := '{}'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('roles:' || p_company_id::text, 414));
  IF EXISTS (SELECT 1 FROM public.roles r WHERE r.company_id = p_company_id) THEN
    RETURN;
  END IF;

  SELECT e.payload INTO v_payload
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

  FOR v_role IN SELECT value FROM jsonb_array_elements(v_payload->'roles') LOOP
    INSERT INTO public.roles (
      company_id, name, description, color, is_system, is_default
    ) VALUES (
      p_company_id,
      v_role->>'name',
      v_role->>'description',
      v_role->>'color',
      false,
      COALESCE((v_role->>'is_default')::boolean, false)
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
     WHERE p.key IN (
       SELECT value #>> '{}' FROM jsonb_array_elements(v_role->'permission_keys')
     )
    ON CONFLICT DO NOTHING;
    v_role_ids := v_role_ids || jsonb_build_object(v_role->>'name', v_role_id::text);
    v_role_id := NULL;
  END LOOP;

  PERFORM public.fn_record_company_catalog_installation(
    p_company_id, 'roles_permissions', 1,
    jsonb_build_object('role_ids', v_role_ids),
    'company-bootstrap', NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_bootstrap_company_defaults(
  p_company_id uuid,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payload jsonb;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_transition_id uuid;
  v_pipeline_refs jsonb;
  v_stage_ids jsonb := '{}'::jsonb;
  v_stage jsonb;
  v_transition jsonb;
  v_action jsonb;
  v_existing boolean;
  v_any_pipeline boolean;
  v_result jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bootstrap:' || p_company_id::text, 414));

  PERFORM public.fn_seed_company_default_roles(p_company_id);

  SELECT e.payload INTO v_payload
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = 'task_workflow.standard'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'task_workflow.standard catalog entry is not published';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.pipelines p
     WHERE p.company_id = p_company_id
       AND p.name = v_payload->>'name'
       AND p.deleted_at IS NULL
  ) INTO v_existing;
  SELECT EXISTS (
    SELECT 1 FROM public.pipelines p
     WHERE p.company_id = p_company_id
       AND p.deleted_at IS NULL
  ) INTO v_any_pipeline;

  IF v_existing THEN
    SELECT p.id INTO v_pipeline_id
      FROM public.pipelines p
     WHERE p.company_id = p_company_id
       AND p.name = v_payload->>'name'
       AND p.deleted_at IS NULL
     ORDER BY p.created_at
     LIMIT 1;
  ELSIF NOT v_any_pipeline THEN
    INSERT INTO public.pipelines (
      company_id, name, description, is_default, created_by,
      visibility_permissions, subject_kind
    ) VALUES (
      p_company_id, v_payload->>'name', v_payload->>'description',
      COALESCE((v_payload->>'is_default')::boolean, true),
      p_created_by, '{}', 'task'
    ) RETURNING id INTO v_pipeline_id;

    FOR v_stage IN SELECT value FROM jsonb_array_elements(v_payload->'stages') AS s(value)
    LOOP
      INSERT INTO public.pipeline_stages (
        pipeline_id, name, color, position, is_initial, is_terminal,
        terminal_type, requires_submission, submission_mode
      ) VALUES (
        v_pipeline_id, v_stage->>'name', v_stage->>'color', (v_stage->>'position')::integer,
        (v_stage->>'is_initial')::boolean, (v_stage->>'is_terminal')::boolean, v_stage->>'terminal_type',
        (v_stage->>'requires_submission')::boolean, v_stage->>'submission_mode'
      ) RETURNING id INTO v_stage_id;
      v_stage_ids := v_stage_ids || jsonb_build_object(v_stage->>'key', v_stage_id::text);
    END LOOP;

    FOR v_transition IN SELECT value FROM jsonb_array_elements(v_payload->'transitions') AS t(value)
    LOOP
      INSERT INTO public.pipeline_stage_transitions (
        from_stage_id, to_stage_id, label, transition_type
      ) VALUES (
        (v_stage_ids->>(v_transition->>'from'))::uuid,
        (v_stage_ids->>(v_transition->>'to'))::uuid,
        v_transition->>'label', (v_transition->>'transition_type')::transition_outcome_type
      ) RETURNING id INTO v_transition_id;
    END LOOP;

    FOR v_action IN SELECT value FROM jsonb_array_elements(v_payload->'actions') AS a(value)
    LOOP
      SELECT t.id INTO v_transition_id
        FROM public.pipeline_stage_transitions t
       WHERE t.from_stage_id = (v_stage_ids->>(v_action->>'from'))::uuid
         AND t.to_stage_id = (v_stage_ids->>(v_action->>'to'))::uuid;
      INSERT INTO public.pipeline_stage_actions (
        stage_id, action_type, label, style, required_role, position,
        is_active, transition_id
      ) VALUES (
        (v_stage_ids->>(v_action->>'from'))::uuid, v_action->>'action_type',
        v_action->>'label', v_action->>'style', v_action->>'required_role',
        (v_action->>'position')::integer, true, v_transition_id
      );
    END LOOP;
  END IF;

  IF v_pipeline_id IS NOT NULL THEN
    v_pipeline_refs := jsonb_build_object('pipeline_id', v_pipeline_id, 'stage_ids', v_stage_ids);
    PERFORM public.fn_record_company_catalog_installation(
      p_company_id, 'task_workflow.standard', 1, v_pipeline_refs,
      'company-bootstrap', p_created_by
    );
  END IF;

  v_result := jsonb_build_object(
    'company_id', p_company_id,
    'roles_catalog_key', 'roles_permissions',
    'workflow_catalog_key', 'task_workflow.standard',
    'pipeline_id', v_pipeline_id
  );
  RETURN v_result;
END;
$function$;

-- Replace the old hard-coded pipeline writer. The trigger installed by
-- 20260804 still invokes fn_seed_company_default_roles, now catalog-backed.
CREATE OR REPLACE FUNCTION public.rpc_create_company_and_link(
  p_company_name text,
  p_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_company_id uuid;
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_owner_role_id uuid;
  v_final_slug text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_slug IS NULL OR p_slug = '' THEN
    v_final_slug := regexp_replace(lower(p_company_name), '[^a-z0-9]+', '-', 'g');
    v_final_slug := trim(both '-' from v_final_slug);
    IF EXISTS (SELECT 1 FROM public.companies c WHERE c.slug = v_final_slug) THEN
      v_final_slug := v_final_slug || '-' || substr(md5(random()::text), 1, 4);
    END IF;
  ELSE
    v_final_slug := p_slug;
  END IF;

  INSERT INTO public.companies (name, slug)
  VALUES (p_company_name, v_final_slug)
  RETURNING id INTO v_company_id;

  SELECT au.email INTO v_user_email FROM auth.users au WHERE au.id = v_user_id;
  INSERT INTO public.users (id, email, company_id, is_owner, is_active)
  VALUES (v_user_id, v_user_email, v_company_id, true, true)
  ON CONFLICT (id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        is_owner = true,
        is_active = true;

  PERFORM public.rpc_bootstrap_company_defaults(v_company_id, v_user_id);

  SELECT r.id INTO v_owner_role_id
    FROM public.roles r
   WHERE r.company_id = v_company_id
     AND r.name = 'Owner'
     AND r.deleted_at IS NULL
   ORDER BY r.created_at
   LIMIT 1;
  IF v_owner_role_id IS NULL THEN
    RAISE EXCEPTION 'catalog bootstrap did not create the company Owner role';
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, company_id)
  VALUES (v_user_id, v_owner_role_id, v_company_id)
  ON CONFLICT DO NOTHING;
  RETURN v_company_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_record_company_catalog_installation(uuid,text,integer,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_bootstrap_company_defaults(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_company_and_link(text,text) TO authenticated;
