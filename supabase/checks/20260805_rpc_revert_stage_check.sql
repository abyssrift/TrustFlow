-- Issue #22 check: rpc_revert_stage moves a task back to its previous stage,
-- records an is_reversal history row, and is gated by is_owner OR the
-- 'pipeline.reverse' permission (not by any random company member).
--
-- Not a migration -- run by hand against a DEV/STAGING database only:
--   psql "$DATABASE_URL" -f supabase/checks/20260805_rpc_revert_stage_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: reuses an existing seeded non-owner user (like
-- check_projects_update_accessible.sql) but creates its own throwaway
-- pipeline/stages/task inside that user's company. Always rolls back --
-- safe to re-run, never leaves rows behind.

BEGIN;

DO $$
DECLARE
  v_co          UUID;
  v_attacker    UUID;   -- same-company user with no pipeline.reverse
  v_pipeline    UUID;
  v_stage_a     UUID;
  v_stage_b     UUID;
  v_stage_c     UUID;
  v_task        UUID;
  v_role        UUID;
  v_current     UUID;
  v_hist_count  INTEGER;
  v_rejected    BOOLEAN := false;
BEGIN
  SELECT company_id, id INTO v_co, v_attacker
  FROM public.users WHERE is_owner = false AND company_id IS NOT NULL LIMIT 1;

  IF v_co IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: no non-owner seeded user found to impersonate';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = v_attacker;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_co, 'Revert Check Pipeline', 'task')
  RETURNING id INTO v_pipeline;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline, 'A', 0, true) RETURNING id INTO v_stage_a;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipeline, 'B', 1) RETURNING id INTO v_stage_b;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipeline, 'C', 2) RETURNING id INTO v_stage_c;

  INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id)
  VALUES (v_co, 'Revert Check Task', v_pipeline, v_stage_a)
  RETURNING id INTO v_task;

  -- Advance A -> B -> C as system (no auth context; mirrors how
  -- rpc_advance_stage treats a NULL auth.uid() as a trusted caller).
  PERFORM public.rpc_advance_stage(v_task, v_stage_b);
  PERFORM public.rpc_advance_stage(v_task, v_stage_c);

  -- Assert 1: a same-company user with no pipeline.reverse and not the
  -- owner is rejected.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN
    PERFORM public.rpc_revert_stage(v_task);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;

  RESET ROLE;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: a user without pipeline.reverse (and not owner) was able to revert';
  END IF;

  -- Assert 2: granting pipeline.reverse lets the same user revert C -> B.
  INSERT INTO public.roles (company_id, name) VALUES (v_co, 'ZZ Reverter') RETURNING id INTO v_role;
  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role, id FROM public.permissions WHERE key = 'pipeline.reverse';
  INSERT INTO public.user_roles (user_id, role_id, company_id) VALUES (v_attacker, v_role, v_co);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  PERFORM public.rpc_revert_stage(v_task);

  RESET ROLE;

  SELECT current_stage_id INTO v_current FROM public.tasks WHERE id = v_task;
  IF v_current IS DISTINCT FROM v_stage_b THEN
    RAISE EXCEPTION 'CHECK FAILED: task did not revert to stage B (got %, expected %)', v_current, v_stage_b;
  END IF;

  SELECT COUNT(*) INTO v_hist_count
  FROM public.pipeline_stage_history
  WHERE task_id = v_task AND from_stage_id = v_stage_c AND to_stage_id = v_stage_b AND is_reversal = TRUE;
  IF v_hist_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected 1 is_reversal history row for C -> B, got %', v_hist_count;
  END IF;

  -- Assert 3: reverting a second time continues back to A instead of
  -- bouncing forward to C (the previous revert's own history row must not
  -- be picked up as "the previous stage").
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  PERFORM public.rpc_revert_stage(v_task);

  RESET ROLE;

  SELECT current_stage_id INTO v_current FROM public.tasks WHERE id = v_task;
  IF v_current IS DISTINCT FROM v_stage_a THEN
    RAISE EXCEPTION 'CHECK FAILED: second revert did not continue back to stage A (got %, expected %)', v_current, v_stage_a;
  END IF;

  -- Assert 4: reverting a task at its initial stage (no prior history) fails.
  DECLARE
    v_task2 UUID;
    v_rejected2 BOOLEAN := false;
  BEGIN
    INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id)
    VALUES (v_co, 'Revert Check Task 2', v_pipeline, v_stage_a)
    RETURNING id INTO v_task2;

    BEGIN
      PERFORM public.rpc_revert_stage(v_task2);
    EXCEPTION WHEN OTHERS THEN
      v_rejected2 := true;
    END;

    IF NOT v_rejected2 THEN
      RAISE EXCEPTION 'CHECK FAILED: reverting a task with no prior stage should have been rejected';
    END IF;
  END;

  RAISE NOTICE 'OK: rpc_revert_stage rejects non-owner/no-permission callers, reverts C -> B and records is_reversal history once granted pipeline.reverse, continues back to A on a second revert (not back to C), and rejects a task with no prior stage';
END $$;

ROLLBACK;
