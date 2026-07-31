-- #173 Projects P3 -- rpc_projects_table: the dense sortable table view
-- (plan §8, "the table comes before the board"). Contract is fixed -- the
-- UI is being built against these exact column names in parallel.
--
-- Rollup definitions are copy-matched from the two existing project
-- aggregators so the table, the dashboard and rpc_get_project_stats can
-- never disagree:
--   - "done" = a task whose current stage is terminal AND terminal_type =
--     'success' (rpc_project_dashboard's v_totals, rpc_get_project_stats).
--   - weighted_progress = completed_weight / total_weight * 100, where
--     *_weight are SUM(tasks.weight) over the same "done" predicate
--     (rpc_project_dashboard's total_weight/completed_weight, made into a
--     percentage here since the table has no room for two raw numbers).
--   - tracked_seconds = SUM(task_work_sessions.total_seconds_spent) over a
--     project's tasks, unfiltered by session status (rpc_project_dashboard).
--   - estimated_hours = SUM(tasks.estimated_hours) (rpc_project_dashboard's
--     est_hours) -- the derived value plan §3.3 requires instead of a
--     stored projects.estimated_hours column.
--
-- days_in_current_stage: MAX(project_stage_history.transitioned_at) for the
-- project's current stage, per §8's "free once project stage history
-- exists" -- that table's sole writer is trg_projects_stage_history
-- (§13.2), so this number can't silently understate the way an
-- RPC-maintained counter could. NULL when the project has never been
-- staged (no history row yet). Whole days via EXTRACT(DAY FROM ...),
-- matching the existing days_in_pipeline convention (see
-- 20260512_task_detail_view_permission.sql).
--
-- Tenant scoping matches every sibling project RPC: company_id =
-- my_company_id(), same as projects_select. projects_select is
-- company-wide (not permission-narrowed per pipeline the way task RLS is),
-- so this SECURITY DEFINER function doesn't add a narrower filter than the
-- table already has -- it only adds the project.view gate that
-- rpc_project_dashboard already requires for this class of KPI-bearing
-- read (rpc_get_projects, the plain listing RPC, has no such gate; this
-- one exposes owner/tracked-time/progress like the dashboard does, so it
-- follows the dashboard's stricter precedent).
--
-- Pagination is mandatory per §8's flagged hazard (task board loads
-- everything, no limit) -- p_limit is clamped to <=500 so a caller can't
-- accidentally request an unbounded result set.
--
-- Default sort: days_in_current_stage DESC NULLS LAST, id. Server-side
-- default because it's already computed in this same query (no extra cost)
-- and because §8 calls it "the highest-leverage" field -- surfacing the
-- longest-stuck projects first is a reasonable zero-config default. `id` is
-- a tiebreaker, not a design choice about ordering -- most projects tie on
-- NULL, and without a deterministic tiebreaker two paginated calls (LIMIT/
-- OFFSET) aren't guaranteed disjoint. The UI is free to re-sort
-- client-side on any of the seven fields; this is a default, not
-- enforcement.

CREATE OR REPLACE FUNCTION public.rpc_projects_table(
  p_search   TEXT    DEFAULT NULL,
  p_stage_id UUID    DEFAULT NULL,
  p_blocked  BOOLEAN DEFAULT NULL,
  p_limit    INT     DEFAULT 100,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE (
  id                      UUID,
  name                    TEXT,
  color                   TEXT,
  client_id               UUID,
  client_name             TEXT,
  portfolio_id            UUID,
  portfolio_name          TEXT,
  current_stage_id        UUID,
  stage_name              TEXT,
  stage_color             TEXT,
  days_in_current_stage   INT,
  due_date                TIMESTAMPTZ,
  days_remaining          INT,
  tasks_total             INT,
  tasks_done              INT,
  weighted_progress       NUMERIC,
  owner_id                UUID,
  owner_name              TEXT,
  owner_avatar_url        TEXT,
  blocked                 BOOLEAN,
  blocked_reason          TEXT,
  tracked_seconds         BIGINT,
  estimated_hours         NUMERIC,
  updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := public.my_company_id();
BEGIN
  IF NOT public.has_permission('project.view') THEN
    RAISE EXCEPTION 'Insufficient permissions to view projects.';
  END IF;

  RETURN QUERY
  WITH stage_age AS (
    SELECT DISTINCT ON (psh.project_id)
      psh.project_id, psh.transitioned_at
    FROM public.project_stage_history psh
    WHERE psh.company_id = v_company_id
    ORDER BY psh.project_id, psh.transitioned_at DESC
  ),
  task_rollup AS (
    SELECT
      t.project_id,
      COUNT(*)::INT AS tasks_total,
      COUNT(*) FILTER (
        WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
      )::INT AS tasks_done,
      COALESCE(SUM(t.weight), 0) AS total_weight,
      COALESCE(SUM(t.weight) FILTER (
        WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
      ), 0) AS completed_weight,
      COALESCE(SUM(t.estimated_hours), 0) AS estimated_hours
    FROM public.tasks t
    LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
    GROUP BY t.project_id
  ),
  time_rollup AS (
    SELECT t.project_id, COALESCE(SUM(ws.total_seconds_spent), 0)::BIGINT AS tracked_seconds
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
    GROUP BY t.project_id
  )
  SELECT
    p.id,
    p.name,
    p.color,
    p.client_id,
    c.name AS client_name,
    p.portfolio_id,
    pf.name AS portfolio_name,
    p.current_stage_id,
    ps.name AS stage_name,
    ps.color AS stage_color,
    (CASE WHEN sa.transitioned_at IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM (now() - sa.transitioned_at))::INT END) AS days_in_current_stage,
    p.due_date,
    (CASE WHEN p.due_date IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM (p.due_date - now()))::INT END) AS days_remaining,
    COALESCE(tr.tasks_total, 0) AS tasks_total,
    COALESCE(tr.tasks_done, 0) AS tasks_done,
    (CASE WHEN COALESCE(tr.total_weight, 0) = 0 THEN 0
          ELSE ROUND(tr.completed_weight / tr.total_weight * 100, 2) END) AS weighted_progress,
    p.owner_id,
    u.full_name AS owner_name,
    u.avatar_url AS owner_avatar_url,
    p.blocked,
    p.blocked_reason,
    COALESCE(tmr.tracked_seconds, 0) AS tracked_seconds,
    COALESCE(tr.estimated_hours, 0) AS estimated_hours,
    p.updated_at
  FROM public.projects p
  LEFT JOIN public.clients c        ON c.id = p.client_id
  LEFT JOIN public.portfolios pf    ON pf.id = p.portfolio_id
  LEFT JOIN public.pipeline_stages ps ON ps.id = p.current_stage_id
  LEFT JOIN public.users u          ON u.id = p.owner_id
  LEFT JOIN stage_age sa            ON sa.project_id = p.id
  LEFT JOIN task_rollup tr          ON tr.project_id = p.id
  LEFT JOIN time_rollup tmr         ON tmr.project_id = p.id
  WHERE p.company_id = v_company_id
    AND p.deleted_at IS NULL
    AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%')
    AND (p_stage_id IS NULL OR p.current_stage_id = p_stage_id)
    AND (p_blocked IS NULL OR p.blocked = p_blocked)
  ORDER BY days_in_current_stage DESC NULLS LAST, p.id
  LIMIT  LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT) TO authenticated;
