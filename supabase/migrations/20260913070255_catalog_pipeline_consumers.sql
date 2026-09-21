-- Issue #414 Task 4: pipeline consumers use the catalog preset.
--
-- The editor remains the writer for arbitrary company pipelines. Quick Setup
-- uses this semantic catalog writer so the UI does not carry a second copy of
-- the platform stages, transitions, or actions.

CREATE OR REPLACE FUNCTION public.rpc_create_catalog_pipeline(
  p_catalog_key text,
  p_catalog_version integer DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_is_default boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_user_id uuid := auth.uid();
  v_entry public.platform_catalog_entries%rowtype;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_transition_id uuid;
  v_stage_ids jsonb := '{}'::jsonb;
  v_stage jsonb;
  v_transition jsonb;
  v_action jsonb;
  v_name text := NULLIF(btrim(p_name), '');
BEGIN
  IF v_company_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = v_user_id
       AND u.company_id = v_company_id
       AND (u.is_owner OR public.has_permission('pipeline.create'))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':pipeline:' || p_catalog_key, 414));
  SELECT e.* INTO v_entry
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h ON h.catalog_key = e.catalog_key AND h.published_version = e.version
   WHERE e.catalog_key = p_catalog_key
     AND (p_catalog_version IS NULL OR e.version = p_catalog_version)
     AND e.kind = 'task_workflow'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow catalog entry is not published';
  END IF;
  v_name := COALESCE(v_name, v_entry.payload->>'name');
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'pipeline name is required';
  END IF;

  INSERT INTO public.pipelines (
    company_id, name, description, is_default, created_by,
    visibility_permissions, subject_kind
  ) VALUES (
    v_company_id, v_name, COALESCE(p_description, v_entry.payload->>'description'),
    p_is_default, v_user_id, '{}', 'task'
  ) RETURNING id INTO v_pipeline_id;

  FOR v_stage IN SELECT value FROM jsonb_array_elements(v_entry.payload->'stages') AS s(value) LOOP
    INSERT INTO public.pipeline_stages (
      pipeline_id, name, color, position, is_initial, is_terminal,
      terminal_type, requires_submission, submission_mode
    ) VALUES (
      v_pipeline_id, v_stage->>'name', v_stage->>'color', (v_stage->>'position')::integer,
      (v_stage->>'is_initial')::boolean, (v_stage->>'is_terminal')::boolean,
      v_stage->>'terminal_type', (v_stage->>'requires_submission')::boolean,
      v_stage->>'submission_mode'
    ) RETURNING id INTO v_stage_id;
    v_stage_ids := v_stage_ids || jsonb_build_object(v_stage->>'key', v_stage_id::text);
  END LOOP;

  FOR v_transition IN SELECT value FROM jsonb_array_elements(v_entry.payload->'transitions') AS t(value) LOOP
    INSERT INTO public.pipeline_stage_transitions (
      from_stage_id, to_stage_id, label, transition_type
    ) VALUES (
      (v_stage_ids->>(v_transition->>'from'))::uuid,
      (v_stage_ids->>(v_transition->>'to'))::uuid,
      v_transition->>'label', (v_transition->>'transition_type')::transition_outcome_type
    ) RETURNING id INTO v_transition_id;
  END LOOP;

  FOR v_action IN SELECT value FROM jsonb_array_elements(v_entry.payload->'actions') AS a(value) LOOP
    SELECT t.id INTO v_transition_id
      FROM public.pipeline_stage_transitions t
     WHERE t.from_stage_id = (v_stage_ids->>(v_action->>'from'))::uuid
       AND t.to_stage_id = (v_stage_ids->>(v_action->>'to'))::uuid;
    INSERT INTO public.pipeline_stage_actions (
      stage_id, action_type, label, style, required_role, position,
      is_active, transition_id
    ) VALUES (
      (v_stage_ids->>(v_action->>'from'))::uuid,
      v_action->>'action_type', v_action->>'label', v_action->>'style',
      v_action->>'required_role', (v_action->>'position')::integer, true,
      v_transition_id
    );
  END LOOP;

  PERFORM public.fn_record_company_catalog_installation(
    v_company_id, v_entry.catalog_key, v_entry.version,
    jsonb_build_object('pipeline_id', v_pipeline_id, 'stage_ids', v_stage_ids),
    'pipeline-quick-setup', v_user_id
  );
  RETURN v_pipeline_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A pipeline named "%" already exists in this company; refusing duplicate preset creation', v_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_create_catalog_pipeline(text,integer,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_catalog_pipeline(text,integer,text,text,boolean) TO authenticated;
