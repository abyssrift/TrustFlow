-- Issue #175 (Projects Phase 5): portfolio flow analytics -- CFD, WIP per
-- stage, cycle time, capacity. Plan docs/PROJECT_HIERARCHY_PLAN.md §9 / §10.
--
-- Four read RPCs, all STABLE SECURITY DEFINER, gated the same way
-- rpc_projects_table is (§13.14 / #186): screen-level `analytics.view`
-- permission (RAISE on failure -- same convention as
-- rpc_get_pipeline_throughput_range), then `public.fn_project_accessible(id)`
-- per row -- the single project-visibility predicate, never a second rule.
-- Denial folds into "zero rows" everywhere, matching §13.14's "no
-- distinguishable denied state" rule for these read paths.
--
-- rpc_portfolio_wip_by_stage: current snapshot, no history needed --
-- projects.current_stage_id grouped by stage. This is the one view that is
-- correct the instant a single project has a stage; it needs no backfill.
--
-- rpc_portfolio_cfd: classic cumulative-flow-diagram data. For stage S at
-- bucket end-date D: COUNT(DISTINCT project) that has EVER reached stage
-- position >= S.position by D, derived from project_stage_history (§13.2
-- established this is trigger-written and trustworthy, never RPC-only).
-- Monotonically non-decreasing per stage by construction -- once a project
-- passes a stage it stays counted as "reached" even if it moves further.
-- The stacked-area band width (WIP sitting in a stage) is
-- cumulative_count(S) - cumulative_count(next stage) -- left to the client
-- to diff, same "hand back addable numbers" shape as
-- rpc_get_pipeline_throughput_range's succeeded/failed columns.
--
-- rpc_portfolio_throughput: arrivals (a project's first-ever stage
-- placement) and completions (first transition into an is_terminal stage)
-- per bucket, WIP at each bucket end, and cycle_time_days = WIP / (
-- completions-in-bucket / bucket-length-in-days) -- Little's Law, literally
-- the "WIP / throughput" the issue asks for, NULL when nothing completed in
-- that bucket rather than a divide-by-zero or a misleading 0.
--
-- rpc_portfolio_capacity: committed_hours = SUM(task.estimated_hours) over
-- OPEN (non-terminal) tasks in accessible projects, per assignee --
-- estimated_hours is a real *task* input column (§13.7; only the *project*
-- rollup of it is forbidden as a stored column). available_hours =
-- SUM(task_work_sessions.total_seconds_spent)/3600 actually logged in
-- [p_from, p_to] on tasks in accessible projects, per assignee -- the same
-- column rpc_projects_table's time_rollup CTE sums, not a new hours source.

CREATE OR REPLACE FUNCTION public.rpc_portfolio_wip_by_stage(p_pipeline_id uuid DEFAULT NULL)
RETURNS TABLE (
  pipeline_id    uuid,
  pipeline_name  text,
  stage_id       uuid,
  stage_name     text,
  stage_position integer,
  is_terminal    boolean,
  wip_count      integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid := public.my_company_id();
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  RETURN QUERY
  SELECT
    pl.id, pl.name,
    ps.id, ps.name, ps.position, ps.is_terminal,
    COUNT(p.id) FILTER (WHERE p.id IS NOT NULL)::INT AS wip_count
  FROM public.pipelines pl
  JOIN public.pipeline_stages ps ON ps.pipeline_id = pl.id
  LEFT JOIN public.projects p
    ON p.current_stage_id = ps.id
   AND p.deleted_at IS NULL
   AND public.fn_project_accessible(p.id)
  WHERE pl.company_id = v_company_id
    AND pl.subject_kind = 'project'
    AND pl.deleted_at IS NULL
    AND (p_pipeline_id IS NULL OR pl.id = p_pipeline_id)
  GROUP BY pl.id, pl.name, ps.id, ps.name, ps.position, ps.is_terminal
  ORDER BY pl.name, ps.position;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_portfolio_cfd(
  p_pipeline_id uuid,
  p_from        date,
  p_to          date,
  p_buckets     integer DEFAULT 12
)
RETURNS TABLE (
  bucket_start     timestamptz,
  bucket_end       timestamptz,
  stage_id         uuid,
  stage_name       text,
  stage_position   integer,
  cumulative_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_t0 timestamptz := p_from::timestamptz;
  v_t1 timestamptz := (p_to + 1)::timestamptz; -- inclusive end date
  v_nb int := LEAST(GREATEST(COALESCE(p_buckets, 12), 1), 60);
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;
  IF v_t1 <= v_t0 THEN RETURN; END IF;

  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND subject_kind = 'project' AND deleted_at IS NULL;
  IF v_company_id IS NULL OR v_company_id != public.my_company_id() THEN RETURN; END IF;

  RETURN QUERY
  WITH stages AS (
    SELECT id, name, position
    FROM public.pipeline_stages
    WHERE pipeline_id = p_pipeline_id
  ),
  buckets AS (
    SELECT gs.i,
           v_t0 + (v_t1 - v_t0) * (gs.i - 1) / v_nb AS b_start,
           v_t0 + (v_t1 - v_t0) * gs.i / v_nb        AS b_end
    FROM generate_series(1, v_nb) AS gs(i)
  ),
  -- Earliest time each accessible project reached each stage-or-beyond: the
  -- first transition INTO a stage whose position >= s.position.
  first_reach AS (
    SELECT psh.project_id, s.id AS stage_id,
           MIN(psh.transitioned_at) AS reached_at
    FROM public.project_stage_history psh
    JOIN public.pipeline_stages to_ps ON to_ps.id = psh.to_stage_id
    JOIN stages s ON s.position <= to_ps.position
    WHERE psh.pipeline_id = p_pipeline_id
      AND public.fn_project_accessible(psh.project_id)
    GROUP BY psh.project_id, s.id
  )
  SELECT
    b.b_start, b.b_end, s.id, s.name, s.position,
    COUNT(DISTINCT fr.project_id) FILTER (WHERE fr.reached_at <= b.b_end)::INT AS cumulative_count
  FROM buckets b
  CROSS JOIN stages s
  LEFT JOIN first_reach fr ON fr.stage_id = s.id
  GROUP BY b.i, b.b_start, b.b_end, s.id, s.name, s.position
  ORDER BY b.i, s.position;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_portfolio_throughput(
  p_pipeline_id uuid,
  p_from        date,
  p_to          date,
  p_buckets     integer DEFAULT 12
)
RETURNS TABLE (
  bucket_start    timestamptz,
  bucket_end      timestamptz,
  arrivals        integer,
  completions     integer,
  wip_end         integer,
  cycle_time_days numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id  uuid;
  v_t0          timestamptz := p_from::timestamptz;
  v_t1          timestamptz := (p_to + 1)::timestamptz;
  v_nb          int := LEAST(GREATEST(COALESCE(p_buckets, 12), 1), 60);
  v_bucket_days numeric;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;
  IF v_t1 <= v_t0 THEN RETURN; END IF;

  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND subject_kind = 'project' AND deleted_at IS NULL;
  IF v_company_id IS NULL OR v_company_id != public.my_company_id() THEN RETURN; END IF;

  v_bucket_days := GREATEST(EXTRACT(EPOCH FROM (v_t1 - v_t0)) / v_nb / 86400.0, 1.0 / 86400);

  RETURN QUERY
  WITH buckets AS (
    SELECT gs.i,
           v_t0 + (v_t1 - v_t0) * (gs.i - 1) / v_nb AS b_start,
           v_t0 + (v_t1 - v_t0) * gs.i / v_nb        AS b_end
    FROM generate_series(1, v_nb) AS gs(i)
  ),
  arrival_events AS (
    -- A project's very first stage placement in this pipeline (no prior
    -- history row for it).
    SELECT psh.project_id, MIN(psh.transitioned_at) AS ts
    FROM public.project_stage_history psh
    WHERE psh.pipeline_id = p_pipeline_id
      AND psh.from_stage_id IS NULL
      AND public.fn_project_accessible(psh.project_id)
    GROUP BY psh.project_id
  ),
  completion_events AS (
    -- First transition into an is_terminal stage, per project.
    SELECT psh.project_id, MIN(psh.transitioned_at) AS ts
    FROM public.project_stage_history psh
    JOIN public.pipeline_stages to_ps ON to_ps.id = psh.to_stage_id AND to_ps.is_terminal
    WHERE psh.pipeline_id = p_pipeline_id
      AND public.fn_project_accessible(psh.project_id)
    GROUP BY psh.project_id
  ),
  wip_at AS (
    -- Live WIP at each bucket end = arrived by then, minus completed by then.
    SELECT b.i,
      (SELECT COUNT(*) FROM arrival_events a WHERE a.ts <= b.b_end)
        - (SELECT COUNT(*) FROM completion_events c WHERE c.ts <= b.b_end) AS wip
    FROM buckets b
  )
  SELECT
    b.b_start, b.b_end,
    COUNT(DISTINCT a.project_id) FILTER (WHERE a.ts >= b.b_start AND a.ts < b.b_end)::INT AS arrivals,
    COUNT(DISTINCT c.project_id) FILTER (WHERE c.ts >= b.b_start AND c.ts < b.b_end)::INT AS completions,
    wa.wip::INT AS wip_end,
    CASE
      WHEN COUNT(DISTINCT c.project_id) FILTER (WHERE c.ts >= b.b_start AND c.ts < b.b_end) = 0 THEN NULL
      ELSE ROUND(
        wa.wip / (COUNT(DISTINCT c.project_id) FILTER (WHERE c.ts >= b.b_start AND c.ts < b.b_end) / v_bucket_days),
      1)
    END AS cycle_time_days
  FROM buckets b
  LEFT JOIN arrival_events a ON true
  LEFT JOIN completion_events c ON true
  JOIN wip_at wa ON wa.i = b.i
  GROUP BY b.i, b.b_start, b.b_end, wa.wip
  ORDER BY b.i;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_portfolio_capacity(p_from date, p_to date)
RETURNS TABLE (
  user_id         uuid,
  full_name       text,
  avatar_url      text,
  committed_hours numeric,
  available_hours numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_t0 timestamptz := p_from::timestamptz;
  v_t1 timestamptz := (p_to + 1)::timestamptz;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  RETURN QUERY
  WITH committed AS (
    SELECT ta.assignee_user_id AS uid, COALESCE(SUM(t.estimated_hours), 0) AS hrs
    FROM public.tasks t
    JOIN public.task_assignments ta ON ta.task_id = t.id AND ta.assignee_user_id IS NOT NULL
    LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
      AND public.fn_project_accessible(t.project_id)
      AND NOT COALESCE(ps.is_terminal, FALSE)
    GROUP BY ta.assignee_user_id
  ),
  available AS (
    SELECT ws.user_id AS uid, COALESCE(SUM(ws.total_seconds_spent), 0) / 3600.0 AS hrs
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
      AND public.fn_project_accessible(t.project_id)
      AND ws.started_at >= v_t0 AND ws.started_at < v_t1
    GROUP BY ws.user_id
  )
  SELECT
    u.id, u.full_name, u.avatar_url,
    ROUND(COALESCE(co.hrs, 0), 1),
    ROUND(COALESCE(av.hrs, 0), 1)
  FROM public.users u
  LEFT JOIN committed co ON co.uid = u.id
  LEFT JOIN available av ON av.uid = u.id
  WHERE u.company_id = v_company_id
    AND u.deleted_at IS NULL
    AND (COALESCE(co.hrs, 0) > 0 OR COALESCE(av.hrs, 0) > 0)
  ORDER BY COALESCE(co.hrs, 0) DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_portfolio_wip_by_stage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_portfolio_cfd(uuid, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_portfolio_throughput(uuid, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_portfolio_capacity(date, date) TO authenticated;
