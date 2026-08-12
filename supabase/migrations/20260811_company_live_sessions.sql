-- Company-scoped "who is working right now".
--
-- THE BUG THIS FIXES: task_work_sessions has exactly ONE select policy, and it
-- is `auth.uid() = user_id` (20260430_v3_bunker_timer.sql:22, and the two other
-- timer migrations that predate it). Every client that reads that table
-- directly therefore sees its OWN row and nothing else, which silently turned
--   - components/tabs/LiveSessionsPopup.tsx ("Live now") into a list of one,
--   - DashboardDataContext's stats.activeSessions ("working now") into 0 or 1.
-- Neither is a UI bug; both are that policy.
--
-- The fix is a SECURITY DEFINER read, NOT a wider RLS policy: "everyone in my
-- company" is a presence feature, not a new default grant on a table that also
-- carries per-user billable duration. The policy stays as-is.
--
-- Tenant scoping is done twice, on purpose:
--   1. the WORKER must be in the caller's company (u.company_id), and
--   2. the TASK must be in the caller's company (t.company_id).
-- The caller's company comes from public.my_company_id() -- the helper the rest
-- of this schema already uses (341 call sites) -- which resolves auth.uid()
-- server-side. No caller-supplied id is accepted, so there is no parameter to
-- tamper with. If my_company_id() is NULL (no session / no company row) both
-- comparisons evaluate to NULL and the function returns zero rows: it fails
-- closed by construction, which is why there is no explicit NULL guard.
--
-- "ACTIVE" = status = 'active' AND a heartbeat inside 8 hours. The 8h window is
-- fn_sweep_stale_work_sessions' threshold (20260715_stale_session_sweep.sql:22)
-- and is deliberately NOT the UI's 90s IDLE_MS: heartbeats are visibility-gated,
-- so a genuinely live session can go hours without one -- that file says "Do not
-- lower" and this must not disagree with it, or the sweep and this list would
-- name different sets of sessions. 90s idle stays a DISPLAY state (the amber dot
-- in lib/sessionPresence), computed by the client from last_heartbeat_at, which
-- is why that column is returned.
--
-- Rows are NOT de-duplicated per person here; both callers do that client-side
-- so the "working now" count and the list are built from one array and cannot
-- disagree.
--
-- PRESENCE IS COMPANY-WIDE; THE TASK IS NOT. SECURITY DEFINER also bypasses
-- tasks_select_visibility (20260803_pipeline_delete_detach_project_tasks.sql:229),
-- which restricts tasks in an `assigned_only` pipeline to their creator/manager/
-- assignees. Without a gate this function would hand every member of the company
-- the title and board of a colleague's private task -- something the direct
-- select it replaced could never do, because that went through tasks RLS and
-- rendered "Unknown task". So `task_title` / `pipeline_name` are NULL unless the
-- caller could have read that task themselves; WHO is working and SINCE WHEN
-- stay visible to everyone, which is the whole point of the feature.
--
-- The gate is public.task_list_visible() (20260718_fix_task_list_visible_
-- pipeline_visibility.sql), NOT a hand-copied predicate: it already mirrors
-- tasks_select_visibility -- system.view_all_data / is_owner / task.view_all /
-- tasks.view_all bypasses, task_visibility_mode, creator/manager/assignee
-- including team assignment -- and it is the function written for exactly this
-- shape, a company-wide sweep that RLS never narrowed (rpc_global_search is the
-- other caller). Copying the policy here would give this repo a third copy to
-- drift; one call cannot.
--
-- It is very slightly STRICTER than the table policy in two places, both safe
-- (they hide a title, never reveal one): it also requires the caller to see the
-- PIPELINE (pipelines_select's visibility_permissions -- layer 1, which the
-- table policy leaves to the board's per-pipeline queries), and it predates
-- #196's `project_id IS NOT NULL AND fn_project_accessible(project_id)` branch
-- for board-detached project tasks. Add that branch to task_list_visible if a
-- detached project task's title ever needs to show here -- it belongs in that
-- one function, so search and this agree, not inlined below.

CREATE OR REPLACE FUNCTION public.rpc_company_live_sessions()
RETURNS TABLE (
  session_id        UUID,
  user_id           UUID,
  full_name         TEXT,
  avatar_url        TEXT,
  task_id           UUID,
  task_title        TEXT,
  pipeline_name     TEXT,
  started_at        TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Every reference is table-qualified: RETURNS TABLE columns are OUT
  -- parameters and an unqualified `user_id` / `started_at` here is ambiguous.
  SELECT
    s.id,
    s.user_id,
    u.full_name,
    u.avatar_url,
    s.task_id,
    -- NULL, not a placeholder string: the two clients already coalesce a missing
    -- title to "Unknown task", which is what the pre-RPC direct select rendered
    -- for a task RLS withheld. Wording stays in the UI layer.
    CASE WHEN v.visible THEN t.title END,
    CASE WHEN v.visible THEN p.name END,
    s.started_at,
    s.last_heartbeat_at
  FROM public.task_work_sessions s
  JOIN public.users u ON u.id = s.user_id
  JOIN public.tasks t ON t.id = s.task_id AND t.deleted_at IS NULL
  LEFT JOIN public.pipelines p ON p.id = t.pipeline_id
  -- LATERAL so the gate is evaluated once per row rather than once per gated
  -- column. Row count here is "timers open in one company", not a table scan.
  CROSS JOIN LATERAL (SELECT public.task_list_visible(t.id) AS visible) v
  WHERE s.status = 'active'
    AND s.last_heartbeat_at > now() - interval '8 hours'
    AND u.company_id = public.my_company_id()
    AND t.company_id = public.my_company_id()
  ORDER BY s.started_at ASC;
$$;

-- SECURITY DEFINER functions are EXECUTE-able by PUBLIC by default; anon has no
-- auth.uid() and would get zero rows anyway, but do not rely on that.
REVOKE EXECUTE ON FUNCTION public.rpc_company_live_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_company_live_sessions() TO authenticated;
