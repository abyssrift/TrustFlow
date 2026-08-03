-- 20260803_pipeline_delete_detach_project_tasks.sql
-- Fixes #196. Sibling of #158 (this same RPC, before projects existed) and
-- #179 (the same shape one level up).
--
-- rpc_delete_pipeline soft-deleted EVERY task on the board:
--     UPDATE public.tasks SET deleted_at = NOW() WHERE pipeline_id = ...
-- and never asked whether those tasks belonged to a project. Since #171/#172
-- a task has TWO parents -- the board it sits on and the project whose work it
-- is -- and the board's delete was silently destroying the other parent's
-- content. Every project rollup filters `t.deleted_at IS NULL`
-- (rpc_projects_table's task_rollup, rpc_get_project_stats,
-- rpc_project_dashboard -- verified), so a 22-task project instantly reported
-- "0 of 0" with no error anywhere. Plan §12 named this exact failure: adding a
-- parent level on top of a cascade that already destroys children.
--
-- ── WHY DETACH, NOT DELETE ────────────────────────────────────────────────
-- The work still exists; the board it lived on does not. A project's tasks are
-- the project. Blocking the delete instead would make a board undeletable for
-- as long as any project ever touched it, which is not a decision the board's
-- owner should be forced into. Moving them to another board would demand a
-- second board that may not exist and is not a decision this RPC can make.
-- So: project-linked tasks lose their board and stay alive on their project;
-- board-only tasks keep the existing soft-delete, which is what deleting a
-- board has always meant and is out of scope to change here.
--
-- ── WHY `current_stage_id` IS DELIBERATELY NOT NULLED ─────────────────────
-- "Null the board columns" is right for `pipeline_id` and WRONG for
-- `current_stage_id`, because in this schema the stage IS the completion
-- record:
--     rpc_projects_table.task_rollup:
--       COUNT(*) FILTER (WHERE COALESCE(ps.is_terminal
--                             AND ps.terminal_type = 'success', FALSE))
--       ... LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
-- Nulling it would reset every finished task to not-done and drive
-- weighted_progress to 0 -- the identical silent-wrong-number bug this issue
-- is about, just arrived at from the other direction. It would also fire four
-- triggers per row (tr_auto_stop_timer, trg_tasks_notify_update,
-- trg_tasks_sync_status, trg_tasks_harvest_deliverable), i.e. a notification
-- storm and a deliverable harvest on a board being deleted.
-- The reference stays resolvable: this RPC soft-deletes the pipeline but does
-- not touch pipeline_stages, so the stage row survives and keeps answering
-- is_terminal/terminal_type exactly as before.
--
-- ── WHY tasks_select_visibility HAD TO CHANGE ────────────────────────────
-- Nulling pipeline_id moves the task onto the policy's existing
-- `pipeline_id IS NULL` branch, which only admitted created_by / manager_id /
-- task.view_all. An assignee who is neither creator nor manager would have
-- watched their project work disappear -- trading silent data loss for silent
-- visibility loss. The branch now also admits anyone who can see the project,
-- via fn_project_accessible (the registered predicate from #186, already the
-- gate on projects_select and the four SECURITY DEFINER project readers).
-- This is the correct owner of the decision anyway: without it, a board that
-- no longer exists would keep governing who may read the project's tasks
-- through its frozen task_visibility_mode / visibility_permissions, with no
-- surface left to edit it. The widening is bounded by fn_project_accessible's
-- own floor (same company, project not deleted), so it cannot cross a tenant.
--
-- ── PREVIEW / COMMIT AGREEMENT (plan §13.10) ─────────────────────────────
-- rpc_preview_delete_pipeline is not a parallel implementation of the rules --
-- rpc_delete_pipeline CALLS it, as its first statement, and returns its exact
-- output. Every validation (existence, tenant, permission, the #158
-- active-timer guard) lives in the preview and therefore raises identically on
-- both paths. A successful preview is a promise the commit will also succeed
-- because it is literally the same code having already succeeded.

-- ── 1. Preview = the single source of both the rules and the numbers ──────
CREATE OR REPLACE FUNCTION public.rpc_preview_delete_pipeline(p_pipeline_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_name       TEXT;
  v_user_id    UUID := auth.uid();
  v_blocker    RECORD;
  v_result     JSONB;
BEGIN
  SELECT company_id, name INTO v_company_id, v_name
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.delete')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- #158: same active-timer guard rpc_archive_task uses, applied board-wide.
  -- It lives HERE so the preview refuses for the same reason the commit would,
  -- instead of quoting a count the commit then declines to deliver.
  SELECT COALESCE(u.display_name, u.full_name, u.email, 'Someone') AS who,
         t.title AS task_title
    INTO v_blocker
    FROM public.task_work_sessions ws
    JOIN public.tasks t  ON t.id = ws.task_id
    LEFT JOIN public.users u ON u.id = ws.user_id
   WHERE t.pipeline_id = p_pipeline_id
     AND t.deleted_at IS NULL
     AND ws.status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Concurrency Lock: % has an active timer on "%". Stop it before deleting this board.',
      v_blocker.who, v_blocker.task_title;
  END IF;

  WITH board AS (
    SELECT t.id, t.project_id
    FROM public.tasks t
    WHERE t.pipeline_id = p_pipeline_id AND t.deleted_at IS NULL
  ), proj AS (
    SELECT p.id, p.name
    FROM public.projects p
    WHERE p.id IN (SELECT project_id FROM board WHERE project_id IS NOT NULL)
      AND p.deleted_at IS NULL
    ORDER BY p.name
  )
  SELECT jsonb_build_object(
    'pipeline_id',       p_pipeline_id,
    'pipeline_name',     v_name,
    'tasks_total',       (SELECT count(*) FROM board),
    -- Detached / deleted is decided ONLY by project_id, matching the commit's
    -- two UPDATE predicates one-for-one. A task pointing at a soft-deleted
    -- project still counts as detached: the commit keeps it alive too, and
    -- restoring the project must find its work intact.
    'tasks_detached',    (SELECT count(*) FROM board WHERE project_id IS NOT NULL),
    'tasks_deleted',     (SELECT count(*) FROM board WHERE project_id IS NULL),
    'projects_affected', (SELECT count(DISTINCT project_id) FROM board WHERE project_id IS NOT NULL),
    'projects',          (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb) FROM proj)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_preview_delete_pipeline(uuid) TO authenticated, service_role;

-- ── 2. Commit ─────────────────────────────────────────────────────────────
-- Return type changes void -> jsonb, so this is a DROP + CREATE. CREATE OR
-- REPLACE cannot change a return type at all, and adding a parameter to route
-- around that would have produced an OVERLOAD, not a replacement -- the exact
-- failure 20260802_drop_stale_stage_rpc_overloads.sql had to clean up. The
-- signature assertion at the bottom of this file is what proves it did not
-- happen again. Grants are re-issued because DROP takes them with it.
DROP FUNCTION IF EXISTS public.rpc_delete_pipeline(uuid);

CREATE FUNCTION public.rpc_delete_pipeline(p_pipeline_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_impact     JSONB;
  v_gone       UUID[];
BEGIN
  -- Validates AND measures. Raises for not-found / cross-tenant / missing
  -- permission / running timer before anything is written.
  v_impact := public.rpc_preview_delete_pipeline(p_pipeline_id);

  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;

  -- #196: project work survives its board. pipeline_id only -- see the header
  -- for why current_stage_id stays.
  UPDATE public.tasks
  SET pipeline_id = NULL, updated_at = NOW()
  WHERE pipeline_id = p_pipeline_id
    AND deleted_at IS NULL
    AND project_id IS NOT NULL;

  -- Board-only tasks: unchanged behaviour. The detach above already removed
  -- every project-linked row from this predicate's reach.
  WITH gone AS (
    UPDATE public.tasks
    SET deleted_at = NOW()
    WHERE pipeline_id = p_pipeline_id AND deleted_at IS NULL
    RETURNING id
  )
  SELECT array_agg(id) INTO v_gone FROM gone;

  -- A surviving (detached) task must not be left pointing UP at a task that
  -- was just deleted: parent_task_id is what every subtree walk (#156/#159)
  -- follows. project_id is NOT inherited by subtasks -- no trigger does it,
  -- confirmed against pg_trigger -- so a project task with a board-only child,
  -- or a board-only parent with a project child, is reachable, not theoretical.
  -- Separate statement, not a second leg of the CTE above: two updates to the
  -- same row inside one statement have undefined precedence.
  UPDATE public.tasks
  SET parent_task_id = NULL, updated_at = NOW()
  WHERE deleted_at IS NULL
    AND parent_task_id = ANY(v_gone);

  UPDATE public.pipelines
  SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
  WHERE id = p_pipeline_id;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.deleted',
    jsonb_build_object('pipeline_id', p_pipeline_id) || v_impact
  );

  -- The caller gets back exactly what the preview promised.
  RETURN v_impact;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_pipeline(uuid) TO authenticated, service_role;

-- ── 3. Detached project tasks stay visible to the project's people ────────
-- Only the `pipeline_id IS NULL` branch changes; every other branch is
-- byte-identical to the policy this replaces.
DROP POLICY IF EXISTS tasks_select_visibility ON public.tasks;

CREATE POLICY tasks_select_visibility ON public.tasks
FOR SELECT TO authenticated
USING (
  company_id = public.my_company_id()
  AND (
    public.has_permission('system.view_all_data')
    OR (SELECT users.is_owner FROM public.users WHERE users.id = auth.uid()) = true
    OR EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = tasks.pipeline_id
        AND (
          public.has_permission('task.view_all')
          OR public.has_permission('tasks.view_all')
          OR p.task_visibility_mode = 'all'
          OR (
            p.task_visibility_mode = 'assigned_only'
            AND (
              tasks.created_by = auth.uid()
              OR tasks.manager_id = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.task_assignments ta
                WHERE ta.task_id = tasks.id
                  AND (
                    ta.assignee_user_id = auth.uid()
                    OR ta.assignee_team_id IN (
                      SELECT tm.team_id FROM public.team_members tm
                      WHERE tm.user_id = auth.uid() AND tm.removed_at IS NULL
                    )
                  )
              )
            )
          )
        )
    )
    OR (
      pipeline_id IS NULL
      AND (
        created_by = auth.uid()
        OR manager_id = auth.uid()
        OR public.has_permission('task.view_all')
        OR public.has_permission('tasks.view_all')
        -- #196: a task detached by a board delete is still project work.
        OR (project_id IS NOT NULL AND public.fn_project_accessible(project_id))
      )
    )
  )
);

-- ── 4. Assert exactly one signature each ─────────────────────────────────
DO $verify$
DECLARE
  v_del INT; v_prev INT; v_ret TEXT;
BEGIN
  SELECT count(*) INTO v_del  FROM pg_proc WHERE proname = 'rpc_delete_pipeline';
  SELECT count(*) INTO v_prev FROM pg_proc WHERE proname = 'rpc_preview_delete_pipeline';

  IF v_del != 1 THEN
    RAISE EXCEPTION 'rpc_delete_pipeline has % signatures, expected exactly 1 (overload!)', v_del;
  END IF;
  IF v_prev != 1 THEN
    RAISE EXCEPTION 'rpc_preview_delete_pipeline has % signatures, expected exactly 1 (overload!)', v_prev;
  END IF;

  SELECT pg_get_function_result(oid) INTO v_ret FROM pg_proc WHERE proname = 'rpc_delete_pipeline';
  IF v_ret != 'jsonb' THEN
    RAISE EXCEPTION 'rpc_delete_pipeline returns %, expected jsonb', v_ret;
  END IF;

  RAISE NOTICE '#196: rpc_delete_pipeline/rpc_preview_delete_pipeline -- 1 signature each, returns jsonb';
END
$verify$;
