-- ====================================================================
-- Fix task_list_visible: respect pipeline visibility_permissions
--
-- BUG (reported): a user with access only to the audit pipeline could
-- search and see tasks in the software pipeline.
--
-- Root cause: task visibility in TrustFlow is TWO layers —
--   1. pipelines_select RLS: can the user see the pipeline at all?
--      (visibility_permissions = list of role ids; empty = open to all;
--       system.view_all_data / is_owner override)
--   2. task_visibility_mode: within a visible pipeline, 'all' vs
--      'assigned_only'.
-- The normal task board enforces layer 1 by only querying tasks for
-- pipelines the user can see. rpc_global_search sweeps EVERY task in the
-- company and filtered only through task_list_visible(), which
-- implemented layer 2 but NOT layer 1. Any task in a restricted pipeline
-- with task_visibility_mode='all' therefore leaked to every user in the
-- company via search.
--
-- Fix: task_list_visible() now also requires the caller to be able to see
-- the pipeline (mirrors pipelines_select). Only system.view_all_data /
-- is_owner bypass pipeline visibility. task.view_all / tasks.view_all
-- bypass task_visibility_mode but NOT pipeline access, matching the board.
--
-- task_list_visible is used only by rpc_global_search, so blast radius is
-- limited to search. Applied to prod (wbvgufqfgbvbinjrdzlg) 2026-07-18 and
-- verified: audit-only user no longer sees software-pipeline tasks; users
-- holding the pipeline role still do.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.task_list_visible(p_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id AND t.deleted_at IS NULL AND t.company_id = public.my_company_id()
      AND (
        public.has_permission('system.view_all_data')
        OR COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
        OR EXISTS (
          SELECT 1 FROM public.pipelines p
          WHERE p.id = t.pipeline_id
            AND p.deleted_at IS NULL
            -- layer 1: pipeline must be visible to the caller (mirrors pipelines_select)
            AND (
              p.visibility_permissions = '{}'::text[]
              OR EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = auth.uid()
                  AND ur.company_id = public.my_company_id()
                  AND ur.revoked_at IS NULL
                  AND (ur.role_id)::text = ANY (p.visibility_permissions)
              )
            )
            -- layer 2: task-level visibility within a pipeline the caller can see
            AND (
              public.has_permission('task.view_all')
              OR public.has_permission('tasks.view_all')
              OR p.task_visibility_mode = 'all'
              OR (p.task_visibility_mode = 'assigned_only' AND (
                   t.created_by = auth.uid() OR t.manager_id = auth.uid()
                   OR EXISTS (
                     SELECT 1 FROM public.task_assignments ta
                     WHERE ta.task_id = t.id
                       AND (ta.assignee_user_id = auth.uid()
                            OR ta.assignee_team_id IN (
                              SELECT tm.team_id FROM public.team_members tm
                              WHERE tm.user_id = auth.uid() AND tm.removed_at IS NULL))
                   )))
            )
        )
        OR (t.pipeline_id IS NULL AND (
              t.created_by = auth.uid() OR t.manager_id = auth.uid()
              OR public.has_permission('task.view_all') OR public.has_permission('tasks.view_all')))
      )
  );
$function$;
