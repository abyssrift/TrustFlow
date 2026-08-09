-- Phase 10's projection is the number five surfaces will show. If it is wrong
-- they are all wrong together, and confidently — which §16.2 argues is worse
-- than showing nothing. Six things have to hold:
--
--   1. below MIN_PROJECTION_SAMPLE there is NO date, and the boundary sits at
--      exactly 4 -> none / 5 -> forecast. projection.ts's canProject() re-checks
--      5 client-side, so a server that forecast from 4 would have its answer
--      silently dropped and the two halves would disagree about why the chart
--      is empty;
--   2. the pace counts idle time. A burst followed by a stall must project
--      LATER than the burst alone would suggest — measuring between
--      completions instead of from first-completion-to-now is the flattering
--      bug this guards against;
--   3. a finished project projects its ACTUAL end, not an extrapolation;
--   4. enough done tasks but no datable history is a REFUSAL, not a rate of
--      "everything finished today";
--   5. rpc_project_health refuses a project the caller cannot see (#185);
--   6. "done" is `is_terminal AND terminal_type = 'success'` — the pipeline
--      architecture's definition — and the count is byte-identical to
--      rpc_projects_table.tasks_done. A task carrying a completed_at stamp
--      while sitting in a non-success stage must NOT count: the stamp is
--      denormalised, the stage is the state machine, and a forecast counting
--      the stamp could disagree with the progress bar beside it.
--
-- Fixtures build their own pipeline with a real non-terminal and success-
-- terminal stage, and record transitions in pipeline_stage_history, because
-- that is now where timing comes from. Marking a task done by writing
-- completed_at would no longer make it done, which is the point.
--
-- Everything runs in ONE transaction and rolls back.
BEGIN;

SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_company  UUID;
  v_user     UUID;
  v_pipe     UUID;
  v_open     UUID;
  v_success  UUID;
  v_proj     UUID;
  v_stalled  UUID;
  v_fin      UUID;
  v_nohist   UUID;
  v_r        RECORD;
  v_r2       RECORD;
  v_health   JSONB;
  v_table    INT;

BEGIN
  SELECT u.company_id, u.id INTO v_company, v_user
  FROM public.users u
  WHERE u.is_owner AND u.company_id IS NOT NULL AND u.deleted_at IS NULL
  ORDER BY u.created_at LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'seed data too thin — need an owner with a company';
  END IF;

  INSERT INTO public.pipelines (company_id, name, is_default, created_by, visibility_permissions)
  VALUES (v_company, 'CHK projection pipeline', FALSE, v_user, '{}') RETURNING id INTO v_pipe;

  -- submission_mode is NOT NULL with no default, so it has to be supplied
  -- explicitly here even though this check does not care about submissions.
  INSERT INTO public.pipeline_stages (pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipe, 'CHK Open', '#6B7280', 1, TRUE, FALSE, NULL, 'none') RETURNING id INTO v_open;
  INSERT INTO public.pipeline_stages (pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipe, 'CHK Done', '#10B981', 2, FALSE, TRUE, 'success', 'none') RETURNING id INTO v_success;

  -- ── 1. the threshold boundary, at exactly 4 and 5 ─────────────────────────
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'CHK proj threshold', 'active', v_user, v_user) RETURNING id INTO v_proj;

  -- 10 tasks; 4 finished, spread across a 20-day window.
  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, pipeline_id, current_stage_id)
  SELECT v_company, 'CHK t'||g, v_proj, v_user, v_user, v_pipe,
         CASE WHEN g <= 4 THEN v_success ELSE v_open END
  FROM generate_series(1, 10) g;

  INSERT INTO public.pipeline_stage_history (task_id, company_id, pipeline_id, from_stage_id, to_stage_id, transitioned_by, transitioned_at)
  SELECT t.id, v_company, v_pipe, v_open, v_success, v_user,
         now() - ((20 - (row_number() OVER (ORDER BY t.title)) * 4) || ' days')::interval
  FROM public.tasks t WHERE t.project_id = v_proj AND t.current_stage_id = v_success;

  SELECT * INTO v_r FROM public.fn_project_projection(v_proj);
  IF v_r.confidence <> 'none' OR v_r.projected_end IS NOT NULL THEN
    RAISE EXCEPTION '4 completions must NOT forecast — got confidence=%, projected_end=%', v_r.confidence, v_r.projected_end;
  END IF;
  IF v_r.sample_size <> 4 THEN
    RAISE EXCEPTION 'sample_size should be 4, got % — the UI puts this number in a sentence', v_r.sample_size;
  END IF;

  -- The 5th flips it on. Moving the STAGE is what makes it done.
  UPDATE public.tasks SET current_stage_id = v_success
  WHERE id = (SELECT id FROM public.tasks WHERE project_id = v_proj AND current_stage_id = v_open LIMIT 1);
  INSERT INTO public.pipeline_stage_history (task_id, company_id, pipeline_id, from_stage_id, to_stage_id, transitioned_by, transitioned_at)
  SELECT t.id, v_company, v_pipe, v_open, v_success, v_user, now() - interval '1 day'
  FROM public.tasks t
  WHERE t.project_id = v_proj AND t.current_stage_id = v_success
    AND NOT EXISTS (SELECT 1 FROM public.pipeline_stage_history h WHERE h.task_id = t.id);

  SELECT * INTO v_r FROM public.fn_project_projection(v_proj);
  IF v_r.confidence = 'none' OR v_r.projected_end IS NULL THEN
    RAISE EXCEPTION '5 completions must forecast — MIN_PROJECTION_SAMPLE drifted away from projection.ts''s 5';
  END IF;
  IF v_r.projected_end <= CURRENT_DATE THEN
    RAISE EXCEPTION 'a project with 5 tasks left must project into the FUTURE, got %', v_r.projected_end;
  END IF;

  -- ── 6. the stamp does not make a task done; the stage does ────────────────
  UPDATE public.tasks SET completed_at = now()
  WHERE project_id = v_proj AND current_stage_id = v_open;

  SELECT * INTO v_r2 FROM public.fn_project_projection(v_proj);
  IF v_r2.tasks_done <> v_r.tasks_done THEN
    RAISE EXCEPTION 'stamping completed_at on tasks still sitting in a NON-success stage changed tasks_done (% -> %). Done must be the stage predicate, not the stamp.',
      v_r.tasks_done, v_r2.tasks_done;
  END IF;

  -- The cross-check against rpc_projects_table happens in section 5, once the
  -- authenticated role is engaged — that RPC gates on project.view and would
  -- refuse the postgres role the fixtures are built with.

  -- ── 2. the stall is counted ───────────────────────────────────────────────
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'CHK proj stalled', 'active', v_user, v_user) RETURNING id INTO v_stalled;

  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, pipeline_id, current_stage_id)
  SELECT v_company, 'CHK s'||g, v_stalled, v_user, v_user, v_pipe,
         CASE WHEN g <= 5 THEN v_success ELSE v_open END
  FROM generate_series(1, 10) g;

  -- One finished 60 days ago, the rest in a burst this week.
  INSERT INTO public.pipeline_stage_history (task_id, company_id, pipeline_id, from_stage_id, to_stage_id, transitioned_by, transitioned_at)
  SELECT t.id, v_company, v_pipe, v_open, v_success, v_user,
         CASE WHEN row_number() OVER (ORDER BY t.title) = 1
              THEN now() - interval '60 days'
              ELSE now() - ((5 - row_number() OVER (ORDER BY t.title)) || ' days')::interval END
  FROM public.tasks t WHERE t.project_id = v_stalled AND t.current_stage_id = v_success;

  SELECT * INTO v_r2 FROM public.fn_project_projection(v_stalled);
  IF v_r2.projected_end IS NULL THEN
    RAISE EXCEPTION 'the stalled project should still forecast (5 completions)';
  END IF;
  IF v_r2.projected_end <= v_r.projected_end THEN
    RAISE EXCEPTION 'a project that stalled for 60 days must project LATER than a steady one (stalled=% steady=%) — the pace is being measured between completions instead of from first completion to now',
      v_r2.projected_end, v_r.projected_end;
  END IF;

  -- ── 3. a finished project reports its real end ────────────────────────────
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'CHK proj finished', 'active', v_user, v_user) RETURNING id INTO v_fin;

  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, pipeline_id, current_stage_id)
  SELECT v_company, 'CHK f'||g, v_fin, v_user, v_user, v_pipe, v_success FROM generate_series(1, 6) g;

  INSERT INTO public.pipeline_stage_history (task_id, company_id, pipeline_id, from_stage_id, to_stage_id, transitioned_by, transitioned_at)
  SELECT t.id, v_company, v_pipe, v_open, v_success, v_user,
         now() - ((30 - (row_number() OVER (ORDER BY t.title)) * 2) || ' days')::interval
  FROM public.tasks t WHERE t.project_id = v_fin;

  SELECT * INTO v_r FROM public.fn_project_projection(v_fin);
  IF v_r.projected_end <> v_r.last_done THEN
    RAISE EXCEPTION 'a finished project must project its ACTUAL end (%), got %', v_r.last_done, v_r.projected_end;
  END IF;
  IF v_r.projected_end > CURRENT_DATE THEN
    RAISE EXCEPTION 'a finished project must not project into the future, got %', v_r.projected_end;
  END IF;

  -- ── 4. done, but nothing datable, is a refusal ────────────────────────────
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'CHK proj undatable', 'active', v_user, v_user) RETURNING id INTO v_nohist;

  -- In a success stage, but no history rows and no completed_at at all.
  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, pipeline_id, current_stage_id)
  SELECT v_company, 'CHK u'||g, v_nohist, v_user, v_user, v_pipe,
         CASE WHEN g <= 6 THEN v_success ELSE v_open END
  FROM generate_series(1, 10) g;

  SELECT * INTO v_r FROM public.fn_project_projection(v_nohist);
  IF v_r.tasks_done <> 6 THEN
    RAISE EXCEPTION 'the stage predicate should still count 6 done, got %', v_r.tasks_done;
  END IF;
  IF v_r.projected_end IS NOT NULL OR v_r.confidence <> 'none' THEN
    RAISE EXCEPTION 'six done but none datable must refuse to forecast, got end=% confidence=% — GREATEST(NULL,1) has turned no evidence into "finished today"',
      v_r.projected_end, v_r.confidence;
  END IF;

  -- ── 5. the RPC is gated ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- ── 6 (cont). the forecast and the progress bar count the same set ───────
  SELECT rt.tasks_done INTO v_table
  FROM public.rpc_projects_table(NULL, NULL, NULL, 500, 0, NULL) rt WHERE rt.id = v_proj;

  SELECT * INTO v_r2 FROM public.fn_project_projection(v_proj);
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'rpc_projects_table did not return the check project — cannot prove the two agree';
  END IF;
  IF v_table <> v_r2.tasks_done THEN
    RAISE EXCEPTION 'projection says % done, rpc_projects_table says % — the forecast and the progress bar beside it disagree about the same project', v_r2.tasks_done, v_table;
  END IF;

  v_health := public.rpc_project_health(v_proj);
  IF (v_health->>'sampleSize')::INT <> 5 THEN
    RAISE EXCEPTION 'rpc_project_health disagrees with fn_project_projection about sampleSize: %', v_health->>'sampleSize';
  END IF;
  IF NOT (v_health ? 'projectedEnd' AND v_health ? 'confidence' AND v_health ? 'dueDate') THEN
    RAISE EXCEPTION 'rpc_project_health is missing a ProjectionSeries key — the client assigns these across verbatim: %', v_health;
  END IF;

  BEGIN
    PERFORM public.rpc_project_health('00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'LEAK: rpc_project_health returned data for an inaccessible project — the #185 shape';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'LEAK:%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'check_project_projection: 6/6 pass';
END;
$check$;

ROLLBACK;
