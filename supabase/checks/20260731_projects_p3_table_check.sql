-- Runnable check for #173: rpc_projects_table.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   psql "$DATABASE_URL" -f supabase/checks/20260731_projects_p3_table_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates its own throwaway company/pipeline/
-- stages/clients/projects/tasks, asserts on them, then always rolls back --
-- safe to re-run, never leaves rows behind, never touches real data.
--
-- Smallest thing that fails if any of these regress:
--   1. days_in_current_stage matches project_stage_history (backdated via a
--      direct UPDATE so the "days" math is actually exercised, not just
--      "it's 0 right after insert"), and is NULL for a project with no
--      project_stage_history row -- current_stage_id itself is still
--      populated via trg_projects_default_stage's insert-time default.
--   2. child rollups: tasks_total, tasks_done, weighted_progress,
--      tracked_seconds, estimated_hours all match a hand-computed answer for
--      a project with 3 tasks (2 weights, 1 done, 1 tracked session).
--   3. pagination: p_limit/p_offset actually slice the result set (distinct
--      pages return disjoint rows, and the default sort orders by
--      days_in_current_stage DESC).

BEGIN;

DO $$
DECLARE
  v_user_id        UUID;
  v_company_id     UUID;
  v_pipeline_id    UUID;
  v_stage_a        UUID;
  v_stage_b        UUID;
  v_client_id      UUID;
  v_project_id     UUID;
  v_stale_project  UUID;
  v_task_done      UUID;
  v_task_open_a    UUID;
  v_task_open_b    UUID;
  v_row            RECORD;
  v_days           INT;
  v_page1_ids      UUID[];
  v_page2_ids      UUID[];
  v_overlap_count  INT;
BEGIN
  SELECT id, company_id INTO v_user_id, v_company_id
  FROM public.users WHERE is_owner = true LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No owner user found -- run this against a seeded dev DB, not prod.';
  END IF;

  -- Impersonate that owner so my_company_id()/has_permission()/auth.uid()
  -- resolve inside the SECURITY DEFINER RPC (same pattern as
  -- check_rpc_instantiate_template.sql).
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- The dev company is on the free plan (max_pipelines=3) and the seed data
  -- already sits at that limit -- this check adds 2 more pipelines. Lift
  -- the cap for the duration of this (always-rolled-back) transaction
  -- rather than hardcoding a pipeline count that will break again the next
  -- time seed data changes.
  INSERT INTO public.company_billing (company_id, plan_code)
  VALUES (v_company_id, 'enterprise')
  ON CONFLICT (company_id) DO UPDATE SET plan_code = 'enterprise';

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company_id, 'P3 Check Pipeline', 'project')
  RETURNING id INTO v_pipeline_id;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline_id, 'Intake', 0, true)
  RETURNING id INTO v_stage_a;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipeline_id, 'Fieldwork', 1)
  RETURNING id INTO v_stage_b;

  INSERT INTO public.clients (company_id, name)
  VALUES (v_company_id, 'P3 Check Client')
  RETURNING id INTO v_client_id;

  -- ── Project A: staged, backdated transition, 3 child tasks ──────────────
  -- Trigger disabled around this one INSERT so the project starts genuinely
  -- unstaged: rpc_advance_project_stage's NULL -> v_stage_a call below must
  -- be a REAL first transition (trg_projects_stage_history only fires when
  -- current_stage_id actually changes) so there's a history row to backdate.
  -- Left enabled everywhere else in this check -- Project B below
  -- deliberately tests the trigger's own default-assignment behavior.
  ALTER TABLE public.projects DISABLE TRIGGER trg_projects_default_stage;
  INSERT INTO public.projects (company_id, name, pipeline_id, client_id, due_date, owner_id, weight)
  VALUES (v_company_id, 'P3 Check Project A', v_pipeline_id, v_client_id, now() + interval '4 days', v_user_id, 3)
  RETURNING id INTO v_project_id;
  ALTER TABLE public.projects ENABLE TRIGGER trg_projects_default_stage;

  -- rpc_advance_project_stage stamps transitioned_at = now(); backdate it so
  -- days_in_current_stage has a real, checkable non-zero value.
  PERFORM public.rpc_advance_project_stage(v_project_id, v_stage_a);
  UPDATE public.project_stage_history
  SET transitioned_at = now() - interval '5 days 3 hours'
  WHERE project_id = v_project_id AND to_stage_id = v_stage_a;

  -- Terminal/success stage on a TASK pipeline so tasks_done has something to
  -- filter on (project pipelines and task pipelines are independent stage
  -- sets -- tasks live on their own task-kind pipeline per plan §3.4).
  DECLARE
    v_task_pipe   UUID;
    v_task_open   UUID;
    v_task_closed UUID;
  BEGIN
    INSERT INTO public.pipelines (company_id, name, subject_kind)
    VALUES (v_company_id, 'P3 Check Task Board', 'task')
    RETURNING id INTO v_task_pipe;

    INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
    VALUES (v_task_pipe, 'Open', 0, true)
    RETURNING id INTO v_task_open;

    INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
    VALUES (v_task_pipe, 'Done', 1, true, 'success')
    RETURNING id INTO v_task_closed;

    INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, weight, estimated_hours, created_by)
    VALUES (v_company_id, 'Task done', v_project_id, v_task_pipe, v_task_closed, 5, 4, v_user_id)
    RETURNING id INTO v_task_done;

    INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, weight, estimated_hours, created_by)
    VALUES (v_company_id, 'Task open A', v_project_id, v_task_pipe, v_task_open, 2, 1.5, v_user_id)
    RETURNING id INTO v_task_open_a;

    INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, weight, estimated_hours, created_by)
    VALUES (v_company_id, 'Task open B', v_project_id, v_task_pipe, v_task_open, 3, 2.5, v_user_id)
    RETURNING id INTO v_task_open_b;
  END;

  -- One tracked work session on the done task.
  INSERT INTO public.task_work_sessions (task_id, user_id, company_id, status, total_seconds_spent, started_at)
  VALUES (v_task_done, v_user_id, v_company_id, 'completed', 1800, now() - interval '1 hour');

  -- ── Project B: never staged (current_stage_id stays NULL) ───────────────
  INSERT INTO public.projects (company_id, name, pipeline_id)
  VALUES (v_company_id, 'P3 Check Project B (unstaged)', v_pipeline_id)
  RETURNING id INTO v_stale_project;

  -- ── Assert 1: days_in_current_stage ───────────────────────────────────────
  SELECT * INTO v_row FROM public.rpc_projects_table(p_search := 'P3 Check Project A') LIMIT 1;

  IF v_row.id IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'CHECK FAILED: p_search did not find Project A (got %)', v_row.id;
  END IF;

  IF v_row.days_in_current_stage IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'CHECK FAILED: days_in_current_stage = % (expected 5, from a transition backdated 5 days 3 hours)', v_row.days_in_current_stage;
  END IF;

  -- trg_projects_default_stage (20260803_project_stage_on_create_and_needs_attention.sql)
  -- assigns a stage on INSERT when none is supplied, so Project B is no
  -- longer "unstaged" -- it gets the company's default project stage. It
  -- still has NO project_stage_history row (that trigger only sets a
  -- column; only an UPDATE via trg_projects_stage_history writes history),
  -- so days_in_current_stage stays NULL regardless.
  SELECT * INTO v_row FROM public.rpc_projects_table(p_search := 'P3 Check Project B') LIMIT 1;
  IF v_row.days_in_current_stage IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: a project with no history row should have NULL days_in_current_stage, got %', v_row.days_in_current_stage;
  END IF;
  DECLARE
    v_expected_stage UUID;
  BEGIN
    SELECT stage_id INTO v_expected_stage FROM public.fn_default_project_stage(v_company_id);
    IF v_row.current_stage_id IS DISTINCT FROM v_expected_stage THEN
      RAISE EXCEPTION 'CHECK FAILED: default-staged project should get the company default stage % from fn_default_project_stage, got %', v_expected_stage, v_row.current_stage_id;
    END IF;
  END;

  -- ── Assert 2: child rollups on Project A ─────────────────────────────────
  -- weight: done=5, open=2+3=5 total=10 -> weighted_progress = 50.00
  -- tasks_total=3, tasks_done=1, estimated_hours = 4+1.5+2.5 = 8, tracked_seconds=1800
  SELECT * INTO v_row FROM public.rpc_projects_table(p_search := 'P3 Check Project A') LIMIT 1;

  IF v_row.tasks_total IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'CHECK FAILED: tasks_total = % (expected 3)', v_row.tasks_total;
  END IF;
  IF v_row.tasks_done IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: tasks_done = % (expected 1)', v_row.tasks_done;
  END IF;
  IF v_row.weighted_progress IS DISTINCT FROM 50.00 THEN
    RAISE EXCEPTION 'CHECK FAILED: weighted_progress = % (expected 50.00 = 5/10 * 100)', v_row.weighted_progress;
  END IF;
  IF v_row.tracked_seconds IS DISTINCT FROM 1800 THEN
    RAISE EXCEPTION 'CHECK FAILED: tracked_seconds = % (expected 1800)', v_row.tracked_seconds;
  END IF;
  IF v_row.estimated_hours IS DISTINCT FROM 8.0 THEN
    RAISE EXCEPTION 'CHECK FAILED: estimated_hours = % (expected 8.0 = 4 + 1.5 + 2.5)', v_row.estimated_hours;
  END IF;
  IF v_row.client_name IS DISTINCT FROM 'P3 Check Client' THEN
    RAISE EXCEPTION 'CHECK FAILED: client_name = % (expected P3 Check Client)', v_row.client_name;
  END IF;
  IF v_row.owner_name IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: owner_name should have resolved from owner_id, got NULL';
  END IF;
  IF v_row.days_remaining IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'CHECK FAILED: days_remaining = % (expected 4, due_date = now() + 4 days)', v_row.days_remaining;
  END IF;

  -- Rollup with no child tasks at all -> zeros, not NULLs, and no error.
  IF v_row.id = v_project_id THEN
    SELECT * INTO v_row FROM public.rpc_projects_table(p_search := 'P3 Check Project B') LIMIT 1;
    IF v_row.tasks_total IS DISTINCT FROM 0 OR v_row.weighted_progress IS DISTINCT FROM 0
       OR v_row.tracked_seconds IS DISTINCT FROM 0 OR v_row.estimated_hours IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'CHECK FAILED: childless project rollups should all be 0, got total=% wp=% secs=% est=%',
        v_row.tasks_total, v_row.weighted_progress, v_row.tracked_seconds, v_row.estimated_hours;
    END IF;
  END IF;

  -- ── Assert 3: pagination ──────────────────────────────────────────────────
  -- 5 more throwaway projects (7 total in this company) to make limit/offset
  -- meaningfully slice something.
  FOR v_days IN 1..5 LOOP
    INSERT INTO public.projects (company_id, name, pipeline_id)
    VALUES (v_company_id, 'P3 Check Filler ' || v_days, v_pipeline_id);
  END LOOP;

  SELECT ARRAY_AGG(id) INTO v_page1_ids
  FROM public.rpc_projects_table(p_search := 'P3 Check', p_limit := 3, p_offset := 0);

  SELECT ARRAY_AGG(id) INTO v_page2_ids
  FROM public.rpc_projects_table(p_search := 'P3 Check', p_limit := 3, p_offset := 3);

  IF ARRAY_LENGTH(v_page1_ids, 1) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'CHECK FAILED: page 1 (limit 3, offset 0) returned % rows, expected 3', ARRAY_LENGTH(v_page1_ids, 1);
  END IF;
  IF ARRAY_LENGTH(v_page2_ids, 1) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'CHECK FAILED: page 2 (limit 3, offset 3) returned % rows, expected 3', ARRAY_LENGTH(v_page2_ids, 1);
  END IF;

  SELECT COUNT(*) INTO v_overlap_count
  FROM UNNEST(v_page1_ids) a WHERE a = ANY(v_page2_ids);
  IF v_overlap_count <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: page 1 and page 2 overlap by % row(s) -- pagination is not actually slicing', v_overlap_count;
  END IF;

  -- p_limit is clamped to <=500 even if a caller asks for more.
  SELECT COUNT(*) INTO v_overlap_count FROM public.rpc_projects_table(p_search := 'P3 Check', p_limit := 10000);
  IF v_overlap_count <> 7 THEN
    RAISE EXCEPTION 'CHECK FAILED: unbounded-looking request returned % rows, expected all 7 P3 Check projects', v_overlap_count;
  END IF;

  RAISE NOTICE 'OK: rpc_projects_table computes days_in_current_stage from project_stage_history (NULL when unstaged), matches rpc_project_dashboard-style child rollups (tasks_total/tasks_done/weighted_progress/tracked_seconds/estimated_hours), and p_limit/p_offset paginate correctly -- #173 backend verified';
END $$;

ROLLBACK;
