-- Issue #414 Task 2: deterministic company bootstrap contract.
BEGIN;

DO $check$
DECLARE
  v_company_id uuid;
  v_result jsonb;
  v_result_again jsonb;
  v_roles integer;
  v_stages integer;
  v_transitions integer;
  v_actions integer;
  v_installations integer;
  v_description text;
BEGIN
  ASSERT to_regprocedure('public.rpc_bootstrap_company_defaults(uuid,uuid)') IS NOT NULL,
    'bootstrap RPC missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_companies_seed_default_roles'
       AND tgrelid = 'public.companies'::regclass
  ), 'company role bootstrap trigger missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_bootstrap_company_defaults(uuid,uuid)', 'EXECUTE'),
    'internal bootstrap RPC is exposed to anon';
  ASSERT EXISTS (
    SELECT 1 FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h ON h.catalog_key = e.catalog_key AND h.published_version = e.version
    WHERE e.catalog_key = 'task_workflow.standard'
      AND e.version = 1
      AND e.kind = 'task_workflow'
      AND e.publication_state = 'published'
  ), 'standard workflow catalog entry is not published';

  INSERT INTO public.companies (name, slug)
  VALUES ('__issue414_bootstrap_check__', '__issue414_bootstrap_check__')
  RETURNING id INTO v_company_id;

  SELECT public.rpc_bootstrap_company_defaults(v_company_id, NULL) INTO v_result;
  SELECT count(*) INTO v_roles FROM public.roles WHERE company_id = v_company_id;
  SELECT count(*) INTO v_stages FROM public.pipeline_stages ps JOIN public.pipelines p ON p.id = ps.pipeline_id WHERE p.company_id = v_company_id;
  SELECT count(*) INTO v_transitions FROM public.pipeline_stage_transitions t JOIN public.pipeline_stages ps ON ps.id = t.from_stage_id JOIN public.pipelines p ON p.id = ps.pipeline_id WHERE p.company_id = v_company_id;
  SELECT count(*) INTO v_actions FROM public.pipeline_stage_actions a JOIN public.pipeline_stages ps ON ps.id = a.stage_id JOIN public.pipelines p ON p.id = ps.pipeline_id WHERE p.company_id = v_company_id;
  SELECT count(*) INTO v_installations FROM public.company_catalog_installations WHERE company_id = v_company_id;
  ASSERT v_roles = 4, format('expected four catalog roles, got %s', v_roles);
  ASSERT v_stages = 4, format('expected four standard stages, got %s', v_stages);
  ASSERT v_transitions = 4, format('expected four standard transitions, got %s', v_transitions);
  ASSERT v_actions = 4, format('expected four standard actions, got %s', v_actions);
  ASSERT v_installations = 2, format('expected role and workflow provenance, got %s', v_installations);
  ASSERT (SELECT count(*) FROM public.pipelines WHERE company_id = v_company_id AND name = 'Main Workflow' AND deleted_at IS NULL) = 1,
    'fresh company has duplicate Main Workflow rows';

  SELECT p.description INTO v_description
    FROM public.pipelines p
   WHERE p.id = (SELECT (v_result->>'pipeline_id')::uuid);
  UPDATE public.pipelines
     SET description = 'company customization'
   WHERE id = (v_result->>'pipeline_id')::uuid;
  SELECT public.rpc_bootstrap_company_defaults(v_company_id, NULL) INTO v_result_again;
  ASSERT v_result->>'pipeline_id' = v_result_again->>'pipeline_id', 'bootstrap changed the existing pipeline';
  ASSERT (SELECT description FROM public.pipelines WHERE id = (v_result->>'pipeline_id')::uuid) = 'company customization',
    'bootstrap overwrote a company pipeline customization';
  ASSERT (SELECT count(*) FROM public.pipelines WHERE company_id = v_company_id AND name = 'Main Workflow' AND deleted_at IS NULL) = 1,
    'bootstrap retry created a second Main Workflow';
  ASSERT (SELECT count(*) FROM public.company_catalog_installations WHERE company_id = v_company_id) = 2,
    'bootstrap retry duplicated catalog provenance';

  RAISE NOTICE 'check_company_defaults_bootstrap: contract passed';
END;
$check$;

ROLLBACK;
