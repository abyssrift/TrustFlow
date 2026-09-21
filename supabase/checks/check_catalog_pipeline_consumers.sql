-- Issue #414 Task 4: pipeline preset consumer contract.
BEGIN;

DO $check$
DECLARE
  v_company_id uuid;
  v_owner_id uuid;
  v_pipeline_id uuid;
  v_failed boolean := false;
BEGIN
  ASSERT to_regprocedure('public.rpc_create_catalog_pipeline(text,integer,text,text,boolean)') IS NOT NULL,
    'catalog pipeline RPC missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_create_catalog_pipeline(text,integer,text,text,boolean)', 'EXECUTE'),
    'catalog pipeline RPC ACL missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_create_catalog_pipeline(text,integer,text,text,boolean)', 'EXECUTE'),
    'catalog pipeline RPC leaked to anon';
  ASSERT EXISTS (
    SELECT 1 FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h ON h.catalog_key = e.catalog_key AND h.published_version = e.version
    WHERE e.catalog_key = 'task_workflow.standard'
      AND e.kind = 'task_workflow'
      AND e.payload->'stages' IS NOT NULL
      AND e.payload->'transitions' IS NOT NULL
      AND e.payload->'actions' IS NOT NULL
  ), 'standard workflow catalog payload is incomplete';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.platform_catalog_entries e
     WHERE e.catalog_key = 'task_workflow.standard'
       AND e.payload::text ~ 'pipeline_id|stage_id|team_id|user_id'
  ), 'workflow catalog payload embeds tenant identifiers';

  SELECT c.id INTO v_company_id FROM public.companies c LIMIT 1;
  SELECT u.id INTO v_owner_id FROM public.users u WHERE u.company_id = v_company_id AND u.is_owner LIMIT 1;
  IF v_company_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
    SELECT public.rpc_create_catalog_pipeline(
      'task_workflow.standard', 1, '__issue414_catalog_pipeline__', 'catalog consumer check', false
    ) INTO v_pipeline_id;
    ASSERT (SELECT count(*) FROM public.pipeline_stages WHERE pipeline_id = v_pipeline_id) = 4,
      'catalog pipeline did not materialize four stages';
    ASSERT (SELECT count(*) FROM public.pipeline_stage_transitions t JOIN public.pipeline_stages s ON s.id = t.from_stage_id WHERE s.pipeline_id = v_pipeline_id) = 4,
      'catalog pipeline did not materialize four transitions';
    ASSERT (SELECT count(*) FROM public.pipeline_stage_actions a JOIN public.pipeline_stages s ON s.id = a.stage_id WHERE s.pipeline_id = v_pipeline_id) = 4,
      'catalog pipeline did not materialize four actions';

    BEGIN
      PERFORM public.rpc_create_catalog_pipeline(
        'task_workflow.standard', 1, '__issue414_catalog_pipeline__', 'duplicate', false
      );
    EXCEPTION WHEN OTHERS THEN
      v_failed := true;
      ASSERT SQLERRM LIKE '%already exists%', 'duplicate catalog pipeline has wrong error';
    END;
    ASSERT v_failed, 'duplicate catalog pipeline unexpectedly succeeded';
    ASSERT (SELECT count(*) FROM public.pipelines WHERE company_id = v_company_id AND name = '__issue414_catalog_pipeline__' AND deleted_at IS NULL) = 1,
      'duplicate catalog pipeline was written';
  END IF;

  RAISE NOTICE 'check_catalog_pipeline_consumers: contract passed';
END;
$check$;

ROLLBACK;
