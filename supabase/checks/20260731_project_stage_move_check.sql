-- Runnable check for #172: rpc_advance_project_stage + project_stage_history.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   psql "$DATABASE_URL" -f supabase/checks/20260731_project_stage_move_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates its own throwaway company/pipeline/
-- stages/project, asserts on them, then always rolls back -- safe to re-run,
-- never leaves rows behind, never touches real data.

BEGIN;

DO $$
DECLARE
  v_company_id   UUID;
  v_pipeline_id  UUID;
  v_stage_a      UUID;
  v_stage_b      UUID;
  v_project_id   UUID;
  v_current      UUID;
  v_hist_count   INTEGER;
BEGIN
  INSERT INTO public.companies (name, slug)
  VALUES ('Stage Move Check Co', 'stage-move-check-' || gen_random_uuid())
  RETURNING id INTO v_company_id;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company_id, 'Project Lifecycle Check', 'project')
  RETURNING id INTO v_pipeline_id;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline_id, 'Intake', 0, true)
  RETURNING id INTO v_stage_a;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipeline_id, 'Fieldwork', 1)
  RETURNING id INTO v_stage_b;

  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id)
  VALUES (v_company_id, 'Check Project', v_pipeline_id, v_stage_a)
  RETURNING id INTO v_project_id;

  -- Act: move Intake -> Fieldwork.
  PERFORM public.rpc_advance_project_stage(v_project_id, v_stage_b);

  -- Assert 1: current_stage_id actually moved.
  SELECT current_stage_id INTO v_current FROM public.projects WHERE id = v_project_id;
  IF v_current IS DISTINCT FROM v_stage_b THEN
    RAISE EXCEPTION 'CHECK FAILED: projects.current_stage_id did not update (got %, expected %)', v_current, v_stage_b;
  END IF;

  -- Assert 2: exactly one history row recorded the transition.
  SELECT COUNT(*) INTO v_hist_count
  FROM public.project_stage_history
  WHERE project_id = v_project_id
    AND from_stage_id = v_stage_a
    AND to_stage_id = v_stage_b;

  IF v_hist_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected 1 project_stage_history row for the transition, got %', v_hist_count;
  END IF;

  -- Assert 3: moving to a stage on a task-kind pipeline is rejected.
  DECLARE
    v_task_pipe UUID;
    v_task_stage UUID;
    v_rejected BOOLEAN := false;
  BEGIN
    INSERT INTO public.pipelines (company_id, name, subject_kind)
    VALUES (v_company_id, 'Task Board', 'task')
    RETURNING id INTO v_task_pipe;

    INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
    VALUES (v_task_pipe, 'Open', 0, true)
    RETURNING id INTO v_task_stage;

    BEGIN
      PERFORM public.rpc_advance_project_stage(v_project_id, v_task_stage);
    EXCEPTION WHEN OTHERS THEN
      v_rejected := true;
    END;

    IF NOT v_rejected THEN
      RAISE EXCEPTION 'CHECK FAILED: moving a project onto a task-kind pipeline stage should have been rejected';
    END IF;
  END;

  -- Assert 4 (#172 gap fix): a *direct* UPDATE outside the RPC still
  -- records history. This is the enforcement gap from the newest issue
  -- comment -- before the trigger, this UPDATE moved the project and wrote
  -- nothing to project_stage_history.
  UPDATE public.projects SET current_stage_id = v_stage_a WHERE id = v_project_id;

  SELECT COUNT(*) INTO v_hist_count
  FROM public.project_stage_history
  WHERE project_id = v_project_id
    AND from_stage_id = v_stage_b
    AND to_stage_id = v_stage_a;

  IF v_hist_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: direct UPDATE on projects.current_stage_id did not record history (got % rows, expected 1)', v_hist_count;
  END IF;

  -- Assert 5: rpc_advance_project_stage no longer double-writes now that
  -- the trigger is the sole writer. Total rows so far must be exactly 2
  -- (assert 2's RPC move + assert 4's direct move) -- a no-op UPDATE
  -- (same value) must not add a spurious third.
  UPDATE public.projects SET current_stage_id = v_stage_a WHERE id = v_project_id;

  SELECT COUNT(*) INTO v_hist_count
  FROM public.project_stage_history
  WHERE project_id = v_project_id;

  IF v_hist_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED: total history rows is % (expected 2) -- either a double-write or a spurious no-op row', v_hist_count;
  END IF;

  -- Assert 6: clearing current_stage_id to NULL must succeed and must not
  -- write history. Regression guard for the trigger's WHEN clause --
  -- to_stage_id is NOT NULL on project_stage_history, and current_stage_id's
  -- FK is ON DELETE SET NULL, so a deleted pipeline_stages row fires this
  -- same UPDATE path. Without the NEW.current_stage_id IS NOT NULL guard,
  -- that delete would abort on a NOT NULL violation.
  UPDATE public.projects SET current_stage_id = NULL WHERE id = v_project_id;

  SELECT COUNT(*) INTO v_hist_count
  FROM public.project_stage_history
  WHERE project_id = v_project_id;

  IF v_hist_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED: clearing current_stage_id to NULL should not write history (total %, expected still 2)', v_hist_count;
  END IF;

  RAISE NOTICE 'OK: rpc_advance_project_stage moves stage, records history, rejects task-kind targets, and a direct UPDATE on projects.current_stage_id (bypassing the RPC) now also records history via trg_projects_stage_history -- #172 gap closed';
END $$;

ROLLBACK;
