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
--   4. same-day completions do not divide by zero;
--   5. rpc_project_health refuses a project the caller cannot see (#185);
--   6. the two definitions of "done" in this codebase still agree.
--
-- Everything runs in ONE transaction and rolls back.
BEGIN;

SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_company  UUID;
  v_user     UUID;
  v_pipe     UUID;
  v_stage    UUID;
  v_proj     UUID;
  v_burst    UUID;
  v_done     UUID;
  v_r        RECORD;
  v_r2       RECORD;
  v_health   JSONB;
  v_mismatch INT;
BEGIN
  SELECT u.company_id, u.id INTO v_company, v_user
  FROM public.users u
  WHERE u.is_owner AND u.company_id IS NOT NULL AND u.deleted_at IS NULL
  ORDER BY u.created_at LIMIT 1;

  SELECT ps.pipeline_id, ps.id INTO v_pipe, v_stage
  FROM public.pipeline_stages ps
  JOIN public.pipelines pl ON pl.id = ps.pipeline_id AND pl.company_id = v_company
  LIMIT 1;

  IF v_company IS NULL OR v_stage IS NULL THEN
    RAISE EXCEPTION 'seed data too thin — need an owner and a pipeline stage';
  END IF;

  -- ── 1. the threshold boundary, at exactly 4 and 5 ─────────────────────────
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'CHK proj threshold', 'active', v_user, v_user) RETURNING id INTO v_proj;

  -- 10 tasks, 4 completed over a 20-day window.
  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, current_stage_id, completed_at)
  SELECT v_company, 'CHK t'||g, v_proj, v_user, v_user, v_stage,
         CASE WHEN g <= 4 THEN now() - ((20 - g * 4) || ' days')::interval ELSE NULL END
  FROM generate_series(1, 10) g;

  SELECT * INTO v_r FROM public.fn_project_projection(v_proj);
  IF v_r.confidence <> 'none' OR v_r.projected_end IS NOT NULL THEN
    RAISE EXCEPTION '4 completions must NOT forecast — got confidence=%, projected_end=%', v_r.confidence, v_r.projected_end;
  END IF;
  IF v_r.sample_size <> 4 THEN
    RAISE EXCEPTION 'sample_size should be 4, got % — the UI puts this number in a sentence', v_r.sample_size;
  END IF;

  -- The 5th completion flips it on, and nothing else changed.
  UPDATE public.tasks SET completed_at = now() - interval '1 day'
  WHERE id = (SELECT id FROM public.tasks WHERE project_id = v_proj AND completed_at IS NULL LIMIT 1);

  SELECT * INTO v_r FROM public.fn_project_projection(v_proj);
  IF v_r.confidence = 'none' OR v_r.projected_end IS NULL THEN
    RAISE EXCEPTION '5 completions must forecast — MIN_PROJECTION_SAMPLE drifted away from projection.ts''s 5';
  END IF;
  IF v_r.projected_end <= CURRENT_DATE THEN
    RAISE EXCEPTION 'a project with 5 tasks left must project into the FUTURE, got %', v_r.projected_end;
  END IF;

  -- ── 2. the stall is counted ───────────────────────────────────────────────
  -- Same 5 completions, same 10 tasks — but all five happened in one recent
  -- burst 60 days after the project's first completion. Measuring between
  -- completions would call this fast; measuring elapsed time must not.
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'CHK proj stalled', 'active', v_user, v_user) RETURNING id INTO v_burst;

  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, current_stage_id, completed_at)
  SELECT v_company, 'CHK s'||g, v_burst, v_user, v_user, v_stage,
         CASE WHEN g = 1 THEN now() - interval '60 days'
              WHEN g <= 5 THEN now() - ((5 - g) || ' days')::interval
              ELSE NULL END
  FROM generate_series(1, 10) g;

  SELECT * INTO v_r2 FROM public.fn_project_projection(v_burst);
  IF v_r2.projected_end IS NULL THEN
    RAISE EXCEPTION 'the stalled project should still forecast (5 completions)';
  END IF;
  IF v_r2.projected_end <= v_r.projected_end THEN
    RAISE EXCEPTION 'a project that stalled for 60 days must project LATER than a steady one (stalled=% steady=%) — the pace is being measured between completions instead of from first completion to now',
      v_r2.projected_end, v_r.projected_end;
  END IF;

  -- ── 3. a finished project reports its real end ────────────────────────────
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'CHK proj finished', 'active', v_user, v_user) RETURNING id INTO v_done;

  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, current_stage_id, completed_at)
  SELECT v_company, 'CHK f'||g, v_done, v_user, v_user, v_stage, now() - ((30 - g * 2) || ' days')::interval
  FROM generate_series(1, 6) g;

  SELECT * INTO v_r FROM public.fn_project_projection(v_done);
  IF v_r.projected_end <> v_r.last_done THEN
    RAISE EXCEPTION 'a finished project must project its ACTUAL end (%), got %', v_r.last_done, v_r.projected_end;
  END IF;
  IF v_r.projected_end > CURRENT_DATE THEN
    RAISE EXCEPTION 'a finished project must not project into the future, got %', v_r.projected_end;
  END IF;

  -- ── 4. same-day burst does not divide by zero ─────────────────────────────
  UPDATE public.tasks SET completed_at = now() WHERE project_id = v_done;
  SELECT * INTO v_r FROM public.fn_project_projection(v_done);
  IF v_r.rate_per_day IS NULL OR v_r.rate_per_day <= 0 THEN
    RAISE EXCEPTION 'same-day completions produced a nonsense rate: %', v_r.rate_per_day;
  END IF;

  -- ── 5. the RPC is gated ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_health := public.rpc_project_health(v_proj);
  IF (v_health->>'sampleSize')::INT <> 5 THEN
    RAISE EXCEPTION 'rpc_project_health disagrees with fn_project_projection about sampleSize: %', v_health->>'sampleSize';
  END IF;
  IF NOT (v_health ? 'projectedEnd' AND v_health ? 'confidence' AND v_health ? 'dueDate') THEN
    RAISE EXCEPTION 'rpc_project_health is missing a ProjectionSeries key — the client assigns these across verbatim: %', v_health;
  END IF;

  BEGIN
    PERFORM public.rpc_project_health('00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'rpc_project_health returned data for an inaccessible project — this is the #185 shape';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%#185%' THEN RAISE; END IF;
  END;

  PERFORM set_config('role', 'postgres', true);

  -- ── 6. the two definitions of "done" still agree ──────────────────────────
  SELECT COUNT(*) INTO v_mismatch
  FROM public.tasks t
  LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
  WHERE t.deleted_at IS NULL AND t.project_id IS NOT NULL
    AND t.title NOT LIKE 'CHK %'
    AND (t.completed_at IS NOT NULL) <> COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE);

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION '% task(s) disagree between completed_at and (is_terminal AND success). The projected arm forecasts completed_at while rpc_projects_table counts the stage predicate — they must stay the same set or the chart forecasts a different quantity than the line it grows out of.', v_mismatch;
  END IF;

  RAISE NOTICE 'check_project_projection: 6/6 pass';
END;
$check$;

ROLLBACK;
