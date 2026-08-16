-- Runnable check for issue #265: rpc_get_organizational_audit's `throughput`
-- must count completions (terminal_type = 'success'), not every task in the
-- window -- the bug that made the Throughput KPI tile (116) disagree with
-- the Throughput Trend chart right below it (2) on the same screen.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_organizational_audit_throughput.sql
--
-- Wrapped in BEGIN/ROLLBACK: builds its own throwaway pipeline (3 stages:
-- one open, one terminal/success, one terminal/failure) in an existing
-- seeded company's owner, same convention as check_project_projection.sql.
-- Always rolls back.
--
-- Proves:
--   1. cur_kpi.throughput counts only the 2 success-terminal tasks out of 5
--      in the current window, not all 5 -- and matches success_rate's own
--      numerator exactly (they must never disagree again).
--   2. prev_kpi.throughput (the delta arrow's other half) gets the same
--      completions-only treatment, not the old unfiltered COUNT(DISTINCT).
--   3. A failed-terminal task (terminal_type = 'failure') does NOT count as
--      throughput -- "terminal" alone is not "done".

BEGIN;

SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_company  UUID;
  v_owner    UUID;
  v_pipe     UUID;
  v_open     UUID;
  v_success  UUID;
  v_failure  UUID;
  v_result   JSONB;
  v_cur_thr  INT;
  v_cur_succ NUMERIC;
  v_prev_thr INT;
BEGIN
  SELECT u.company_id, u.id INTO v_company, v_owner
  FROM public.users u
  WHERE u.is_owner AND u.company_id IS NOT NULL AND u.deleted_at IS NULL
  ORDER BY u.created_at LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'seed data too thin -- need an owner with a company';
  END IF;

  INSERT INTO public.pipelines (company_id, name, subject_kind, is_default, created_by, visibility_permissions)
  VALUES (v_company, 'CHK throughput pipeline', 'task', FALSE, v_owner, '{}') RETURNING id INTO v_pipe;

  INSERT INTO public.pipeline_stages (pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipe, 'CHK Open', '#6B7280', 1, TRUE, FALSE, NULL, 'none') RETURNING id INTO v_open;
  INSERT INTO public.pipeline_stages (pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipe, 'CHK Done', '#10B981', 2, FALSE, TRUE, 'success', 'none') RETURNING id INTO v_success;
  INSERT INTO public.pipeline_stages (pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipe, 'CHK Failed', '#EF4444', 3, FALSE, TRUE, 'failure', 'none') RETURNING id INTO v_failure;

  -- Current window (default p_days=30): 5 tasks, only 2 actually completed.
  --   t1, t2 -> success-terminal (the only ones that should count)
  --   t3     -> failure-terminal (terminal, but NOT throughput)
  --   t4, t5 -> still open (not terminal at all)
  INSERT INTO public.tasks (company_id, title, created_by, manager_id, pipeline_id, current_stage_id)
  VALUES
    (v_company, 'CHK thr t1', v_owner, v_owner, v_pipe, v_success),
    (v_company, 'CHK thr t2', v_owner, v_owner, v_pipe, v_success),
    (v_company, 'CHK thr t3', v_owner, v_owner, v_pipe, v_failure),
    (v_company, 'CHK thr t4', v_owner, v_owner, v_pipe, v_open),
    (v_company, 'CHK thr t5', v_owner, v_owner, v_pipe, v_open);

  UPDATE public.tasks SET created_at = now() - interval '5 days', completed_at = now() - interval '4 days'
  WHERE pipeline_id = v_pipe AND title IN ('CHK thr t1', 'CHK thr t2');
  UPDATE public.tasks SET created_at = now() - interval '5 days', completed_at = now() - interval '3 days'
  WHERE pipeline_id = v_pipe AND title = 'CHK thr t3';
  UPDATE public.tasks SET created_at = now() - interval '5 days'
  WHERE pipeline_id = v_pipe AND title IN ('CHK thr t4', 'CHK thr t5');

  -- Previous window (p_days=30 puts it at [now-60d, now-30d)): 2 tasks, 1
  -- completed -- exercises the delta arrow's other half (prev_kpi).
  INSERT INTO public.tasks (company_id, title, created_by, manager_id, pipeline_id, current_stage_id)
  VALUES
    (v_company, 'CHK thr prev-done', v_owner, v_owner, v_pipe, v_success),
    (v_company, 'CHK thr prev-open', v_owner, v_owner, v_pipe, v_open);
  UPDATE public.tasks SET created_at = now() - interval '45 days', completed_at = now() - interval '44 days'
  WHERE pipeline_id = v_pipe AND title = 'CHK thr prev-done';
  UPDATE public.tasks SET created_at = now() - interval '45 days'
  WHERE pipeline_id = v_pipe AND title = 'CHK thr prev-open';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);

  SELECT public.rpc_get_organizational_audit(p_pipeline_id := v_pipe, p_days := 30) INTO v_result;

  RESET ROLE;

  v_cur_thr  := (v_result->'current'->>'throughput')::INT;
  v_cur_succ := (v_result->'current'->>'success_rate')::NUMERIC;
  v_prev_thr := (v_result->'comparison'->>'throughput')::INT;

  IF v_cur_thr <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): current.throughput = % (expected 2 -- only success-terminal tasks, not all 5)', v_cur_thr;
  END IF;
  IF v_cur_succ <> 40.00 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): current.success_rate = % but throughput implies a different completion count -- the tile and the rate must agree', v_cur_succ;
  END IF;

  IF v_prev_thr <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): comparison.throughput = % (expected 1 -- the one success-terminal task in the prior window)', v_prev_thr;
  END IF;

  RAISE NOTICE 'OK: throughput=% (of 5 tasks, 2 completed), success_rate=%, comparison.throughput=% -- KPI tile and Throughput Trend chart now agree', v_cur_thr, v_cur_succ, v_prev_thr;
END $check$;

ROLLBACK;
