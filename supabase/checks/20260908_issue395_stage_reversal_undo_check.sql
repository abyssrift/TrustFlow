-- #395 check: exact inverse of rpc_revert_stage.
-- Run against a disposable/dev database with psql. The transaction rolls back.

BEGIN;

DO $$
DECLARE
  v_company UUID;
  v_user UUID;
  v_unauthorized_user UUID := gen_random_uuid();
  v_pipeline UUID;
  v_a UUID;
  v_b UUID;
  v_c UUID;
  v_task UUID;
  v_other_task UUID;
  v_reversal UUID;
  v_undo UUID;
  v_current UUID;
  v_rejected BOOLEAN;
BEGIN
  SELECT company_id, id INTO v_company, v_user
  FROM public.users WHERE is_owner = true AND company_id IS NOT NULL LIMIT 1;
  IF v_company IS NULL THEN RAISE EXCEPTION 'CHECK SKIPPED: no seeded owner'; END IF;

  INSERT INTO public.pipelines (company_id, name, subject_kind) VALUES (v_company, 'ZZ #395 Pipeline', 'task') RETURNING id INTO v_pipeline;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial) VALUES (v_pipeline, 'A', 0, true) RETURNING id INTO v_a;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position) VALUES (v_pipeline, 'B', 1) RETURNING id INTO v_b;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position) VALUES (v_pipeline, 'C', 2) RETURNING id INTO v_c;
  INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id, created_by)
  VALUES (v_company, 'ZZ #395 Task', v_pipeline, v_a, v_user) RETURNING id INTO v_task;

  -- Seed forward history as trusted system work; then impersonate the user.
  PERFORM public.rpc_advance_stage(v_task, v_b);
  PERFORM public.rpc_advance_stage(v_task, v_c);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- An unaffiliated authenticated identity cannot cross the company boundary.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unauthorized_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_revert_stage(v_task);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: unauthorized revert was accepted'; END IF;

  -- The owner creates the reversal whose returned ID is the undo token.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_reversal := public.rpc_revert_stage(v_task);
  v_undo := public.rpc_undo_stage_reversal(v_task, v_reversal);
  RESET ROLE;

  SELECT current_stage_id INTO v_current FROM public.tasks WHERE id = v_task;
  IF v_current IS DISTINCT FROM v_c OR v_undo IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: happy-path undo did not restore C';
  END IF;

  -- Double call is rejected because the referenced reversal is no longer current.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_undo_stage_reversal(v_task, v_reversal);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: double undo was accepted'; END IF;

  -- A reversal for one task cannot be used against another task.
  INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id, created_by)
  VALUES (v_company, 'ZZ #395 Other Task', v_pipeline, v_c, v_user) RETURNING id INTO v_other_task;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_undo_stage_reversal(v_other_task, v_reversal);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: wrong task/history was accepted'; END IF;

  -- Intervening stage history invalidates the old reversal token.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.rpc_revert_stage(v_task);
  RESET ROLE;
  PERFORM public.rpc_advance_stage(v_task, v_c);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_undo_stage_reversal(v_task, v_reversal);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: stale reversal token was accepted'; END IF;

  RAISE NOTICE 'OK: #395 exact stage-reversal undo contract passed';
END $$;

ROLLBACK;
