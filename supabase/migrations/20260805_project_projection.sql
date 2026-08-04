-- 20260805_project_projection.sql
-- Phase 10 (#191) — the ONE server-side definition of "when will this land".
--
-- This ships BEFORE any of Phase 10's seven surfaces, deliberately. §16.1
-- names the failure outright: five surfaces each inventing their own
-- "projected end date", disagreeing on screen, and the product reading as
-- untrustworthy rather than buggy. The issue's own sequencing note says the
-- portfolio screen and the timeline screen will both want projected dates, so
-- the shared function has to exist first or they will each grow one.
--
-- The client half already exists and has been waiting for this since #198.
-- components/charts/projection.ts defines the contract; ProjectionChart draws
-- it and contains no pace maths by design; useProjectAssignments builds the
-- historical arm and leaves `projectedEnd: null, confidence: 'none'` with a
-- comment naming this migration. Nothing here invents a shape — it fills one.
--
-- ── WHICH "DONE" ────────────────────────────────────────────────────────────
-- Done is `is_terminal AND terminal_type = 'success'` — the pipeline
-- architecture's own definition, and byte-identical to what
-- rpc_projects_table.tasks_done counts. Everything in this product finishes by
-- reaching a success-terminal stage; there is no second way to complete work,
-- so there is no second definition of completion either.
--
-- tasks.completed_at is NOT the membership test. It is a denormalised stamp
-- that happens to agree today (verified: 8 and 8, zero rows differing either
-- way) but is a column that can be null, backfilled, or set by an import,
-- whereas the stage predicate is the actual state machine. Counting the stamp
-- would mean the forecast and the progress bar beside it could disagree about
-- how much is left — the §16.1 failure, one table over.
--
-- TIMING comes from pipeline_stage_history: the FIRST transition into a
-- success-terminal stage, per task. That is the exact task-level analogue of
-- what rpc_portfolio_throughput already does at project level ("first
-- transition into an is_terminal stage"), so the two read the same history the
-- same way. MIN() rather than MAX() because a task that was reopened and
-- re-finished completed once, on the earlier date; taking the later one would
-- let rework quietly inflate recent pace.
--
-- ── WHY THE PACE IS MEASURED FROM FIRST COMPLETION TO *NOW* ─────────────────
-- Not first-to-last completion. Measuring between completions silently
-- excludes every idle stretch — a project that finished five tasks in one week
-- and then stalled for two months would report the busy week's pace and
-- promise a finish date it has no chance of hitting. Dividing by elapsed
-- calendar time since the first completion counts the stall, which is the
-- honest number and always the more conservative one.
--
-- ── HONESTY IS PART OF THE CONTRACT ─────────────────────────────────────────
-- §16.2: "a projection from three stage transitions is noise wearing a date's
-- clothing." MIN_PROJECTION_SAMPLE is 5 in projection.ts, and the 5 below MUST
-- stay equal to it — the client re-checks the threshold in canProject(), so a
-- server that forecast from 4 would have its answer silently discarded and the
-- two halves would disagree about why the chart is empty. The check asserts
-- the boundary at exactly 4 -> none / 5 -> forecast.

CREATE OR REPLACE FUNCTION public.fn_project_projection(p_project_id UUID)
RETURNS TABLE (
  tasks_total   INT,
  tasks_done    INT,
  sample_size   INT,
  first_done    DATE,
  last_done     DATE,
  rate_per_day  NUMERIC,
  projected_end DATE,
  confidence    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total     INT;
  v_done      INT;
  v_first     DATE;
  v_last      DATE;
  v_elapsed   NUMERIC;
  v_rate      NUMERIC;
  v_remaining INT;
  v_days      NUMERIC;
BEGIN
  -- done_at: the first time each task reached a success-terminal stage. Falls
  -- back to completed_at only when a task IS in such a stage but predates the
  -- history table (imported or migrated work) — never the other way round, so
  -- the stamp can add a date to a task the predicate already counts, but can
  -- never add a task the predicate does not.
  WITH scoped AS (
    SELECT t.id, t.completed_at,
           COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE) AS is_done
    FROM public.tasks t
    LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
  ),
  done_at AS (
    SELECT s.id,
           COALESCE(
             (SELECT MIN(h.transitioned_at)
                FROM public.pipeline_stage_history h
                JOIN public.pipeline_stages hs ON hs.id = h.to_stage_id
               WHERE h.task_id = s.id
                 AND COALESCE(hs.is_terminal AND hs.terminal_type = 'success', FALSE)),
             s.completed_at
           )::DATE AS finished_on
    FROM scoped s
    WHERE s.is_done
  )
  SELECT (SELECT COUNT(*)::INT FROM scoped),
         (SELECT COUNT(*)::INT FROM scoped WHERE is_done),
         (SELECT MIN(finished_on) FROM done_at),
         (SELECT MAX(finished_on) FROM done_at)
    INTO v_total, v_done, v_first, v_last;

  -- Below the shared threshold there is no forecast at all, and the reason is
  -- reported as a sample size the UI can put in a sentence rather than a bare
  -- empty state (noProjectionReason() in projection.ts does exactly that).
  --
  -- v_first IS NULL is the same refusal for a different reason: enough tasks
  -- are done, but none of them is datable (no stage history, no stamp), so
  -- there is no elapsed window to divide by. Without this, GREATEST(NULL, 1)
  -- yields 1 and the rate becomes "everything finished today" — the most
  -- optimistic possible answer produced by the least possible evidence.
  IF COALESCE(v_done, 0) < 5 OR v_first IS NULL THEN
    RETURN QUERY SELECT COALESCE(v_total, 0), COALESCE(v_done, 0), COALESCE(v_done, 0),
                        v_first, v_last, NULL::NUMERIC, NULL::DATE, 'none'::TEXT;
    RETURN;
  END IF;

  -- GREATEST(...,1) guards the same-day case: five tasks closed this morning
  -- is a real sample but a zero-length window, and dividing by it would make
  -- the rate infinite and the finish date today.
  v_elapsed   := GREATEST((CURRENT_DATE - v_first)::NUMERIC, 1);
  v_rate      := v_done::NUMERIC / v_elapsed;
  v_remaining := GREATEST(v_total - v_done, 0);

  IF v_remaining = 0 THEN
    -- Already finished. The honest projected end is when it actually ended,
    -- not a date in the future extrapolated from a project with nothing left.
    RETURN QUERY SELECT v_total, v_done, v_done, v_first, v_last, v_rate, v_last,
                        CASE WHEN v_done >= 12 THEN 'ok' ELSE 'low' END::TEXT;
    RETURN;
  END IF;

  v_days := CEIL(v_remaining::NUMERIC / v_rate);

  RETURN QUERY SELECT
    v_total, v_done, v_done, v_first, v_last, v_rate,
    (CURRENT_DATE + v_days::INT)::DATE,
    -- 'ok' needs both a real sample AND a window long enough to have seen a
    -- slow patch. Twelve completions inside two days is a burst, not a pace.
    CASE WHEN v_done >= 12 AND v_elapsed >= 7 THEN 'ok' ELSE 'low' END::TEXT;
END;
$$;

-- Deliberately NOT granted to authenticated. It is SECURITY DEFINER and does
-- no access check of its own, so it is a building block for the gated RPC
-- below, never a public entry point. (The four SECURITY DEFINER readers that
-- each re-implemented project visibility before fn_project_accessible are the
-- reason this distinction gets written down.)
REVOKE ALL ON FUNCTION public.fn_project_projection(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.rpc_project_health(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p    RECORD;
  v_due  TIMESTAMPTZ;
BEGIN
  -- Every new Phase 10 surface is a new place a project can leak (§16, and
  -- the #185 escalation). One predicate, same as everywhere else.
  IF NOT public.fn_project_accessible(p_project_id) THEN
    RAISE EXCEPTION 'Project not found or not accessible.';
  END IF;

  SELECT * INTO v_p FROM public.fn_project_projection(p_project_id);
  SELECT p.due_date INTO v_due FROM public.projects p WHERE p.id = p_project_id;

  -- Keys are camelCase to land directly on ProjectionSeries — the client
  -- assigns them across without a translation layer that could rename a field
  -- into disagreement.
  RETURN jsonb_build_object(
    'tasksTotal',   v_p.tasks_total,
    'tasksDone',    v_p.tasks_done,
    'sampleSize',   v_p.sample_size,
    'firstDone',    v_p.first_done,
    'lastDone',     v_p.last_done,
    'ratePerDay',   v_p.rate_per_day,
    'projectedEnd', v_p.projected_end,
    'dueDate',      v_due,
    'confidence',   v_p.confidence
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_project_health(UUID) TO authenticated;

COMMENT ON FUNCTION public.rpc_project_health(UUID) IS
  'Phase 10 (#191) — the single source of "when will this project land". Every surface reads these numbers; none recomputes them. Fills components/charts/projection.ts''s ProjectionSeries.';
