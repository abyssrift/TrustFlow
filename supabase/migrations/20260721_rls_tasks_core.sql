-- ====================================================================
-- RLS for Core Task Tables
--
-- Enables Row-Level Security on the six core tables that currently
-- have none (tasks, pipelines, pipeline_stages, task_assignments,
-- task_comments, task_mention_acks).  Every visibility rule that was
-- previously enforced only client-side (in _tasks_desktop.tsx and
-- _tasks_adaptive.tsx) is now enforced at the database level.
--
-- SECURITY DEFINER helpers avoid RLS recursion between tables that
-- reference each other in their policies (tasks ↔ task_assignments).
-- ====================================================================

BEGIN;

-- ── Helpers (SECURITY DEFINER, bypass own RLS to avoid recursion) ──

-- Check whether the calling user is assigned to a task (directly or
-- via a team they belong to).  Called from the tasks SELECT policy,
-- so it must bypass RLS on task_assignments to avoid circular checks.
CREATE OR REPLACE FUNCTION public.fn_user_is_assigned_to_task(p_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = p_task_id
      AND (
        ta.assignee_user_id = auth.uid()
        OR ta.assignee_team_id IN (
          SELECT tm.team_id FROM public.team_members tm
          WHERE tm.user_id = auth.uid() AND tm.removed_at IS NULL
        )
      )
  );
$$;

-- Check whether a pipeline has task_visibility_mode = 'assigned_only'.
-- Called from the tasks SELECT policy, so it must bypass RLS on
-- pipelines to avoid circular checks.
CREATE OR REPLACE FUNCTION public.fn_pipeline_has_assigned_only(p_pipeline_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE p.id = p_pipeline_id
      AND p.task_visibility_mode = 'assigned_only'
  );
$$;

-- Combined visibility check: can the calling user see this task?
-- Used by sub-table policies (task_assignments, task_comments, etc.)
-- so they don't need to duplicate the full condition or recurse into
-- the tasks SELECT policy.
CREATE OR REPLACE FUNCTION public.fn_user_can_see_task(p_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
      AND (
        fn_has_permission('task.view_all')
        OR fn_has_permission('tasks.view_all')
        OR fn_has_permission('system.view_all_data')
        OR fn_has_permission('pipeline.edit')
        OR NOT fn_pipeline_has_assigned_only(t.pipeline_id)
        OR t.manager_id = auth.uid()
        OR fn_user_is_assigned_to_task(t.id)
      )
  );
$$;

-- ── 1. public.tasks ──────────────────────────────────────────────

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tasks: select by company and visibility" ON public.tasks
  FOR SELECT USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (
      fn_has_permission('task.view_all')
      OR fn_has_permission('tasks.view_all')
      OR fn_has_permission('system.view_all_data')
      OR fn_has_permission('pipeline.edit')
      OR NOT fn_pipeline_has_assigned_only(pipeline_id)
      OR manager_id = auth.uid()
      OR fn_user_is_assigned_to_task(id)
    )
  );

-- Production task creation goes through rpc_create_task (SECURITY
-- DEFINER, bypasses RLS).  This policy is defence-in-depth for any
-- code that inserts directly.
CREATE POLICY "Tasks: insert in company" ON public.tasks
  FOR INSERT WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- TaskDetailContext updates tasks inline.  Scoped to company only,
-- matching the pre-RLS behaviour (any user in the company could
-- update any task).  Fine-grained edit checks are handled at the
-- application layer.
CREATE POLICY "Tasks: update in company" ON public.tasks
  FOR UPDATE USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  ) WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- Bulk delete only from admin dev-tools page.  Defence-in-depth.
CREATE POLICY "Tasks: delete in company" ON public.tasks
  FOR DELETE USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- ── 2. public.pipelines ──────────────────────────────────────────

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pipelines: select by company" ON public.pipelines
  FOR SELECT USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Pipelines: insert in company" ON public.pipelines
  FOR INSERT WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Pipelines: update in company" ON public.pipelines
  FOR UPDATE USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Pipelines: delete in company" ON public.pipelines
  FOR DELETE USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- ── 3. public.pipeline_stages ────────────────────────────────────

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pipeline stages: select by pipeline company" ON public.pipeline_stages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_stages.pipeline_id
        AND p.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Pipeline stages: insert for company pipeline" ON public.pipeline_stages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_id
        AND p.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Pipeline stages: update for company pipeline" ON public.pipeline_stages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_stages.pipeline_id
        AND p.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_id
        AND p.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Pipeline stages: delete for company pipeline" ON public.pipeline_stages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_stages.pipeline_id
        AND p.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

-- ── 4. public.task_assignments ───────────────────────────────────

ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;

-- A user can see an assignment row only if they can see the task
-- itself (via the combined helper), or if they are the assignee
-- (they always need to know about their own assignments).
CREATE POLICY "Task assignments: select by task visibility or own" ON public.task_assignments
  FOR SELECT USING (
    assignee_user_id = auth.uid()
    OR (
      assignee_team_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = assignee_team_id
          AND tm.user_id = auth.uid()
          AND tm.removed_at IS NULL
      )
    )
    OR fn_user_can_see_task(task_id)
  );

-- All writes flow through SECURITY DEFINER RPCs (rpc_update_task_
-- assignments, rpc_auto_assign_task).  Defence-in-depth policies
-- ensure any direct write is at least scoped to the caller's company.
CREATE POLICY "Task assignments: insert for company task" ON public.task_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND t.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Task assignments: delete for company task" ON public.task_assignments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_assignments.task_id
        AND t.company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

-- ── 5. public.task_comments ──────────────────────────────────────

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Task comments: select by task visibility" ON public.task_comments
  FOR SELECT USING (
    fn_user_can_see_task(task_id)
  );

-- All writes go through rpc_add_task_comment / rpc_delete_task_comment
-- (SECURITY DEFINER).  Defence-in-depth for direct writes.
CREATE POLICY "Task comments: insert for visible task" ON public.task_comments
  FOR INSERT WITH CHECK (
    fn_user_can_see_task(task_id)
  );

CREATE POLICY "Task comments: delete for visible task" ON public.task_comments
  FOR DELETE USING (
    fn_user_can_see_task(task_id)
  );

-- ── 6. public.task_mention_acks ──────────────────────────────────

ALTER TABLE public.task_mention_acks ENABLE ROW LEVEL SECURITY;

-- A user always sees their own mention acks, and can see others'
-- acks for tasks they can view.
CREATE POLICY "Task mention acks: select own or by task visibility" ON public.task_mention_acks
  FOR SELECT USING (
    user_id = auth.uid()
    OR fn_user_can_see_task(task_id)
  );

-- CommentsSection does a direct upsert.  The user may only ack
-- mentions for themselves on a task they can see.
CREATE POLICY "Task mention acks: insert own visible" ON public.task_mention_acks
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND fn_user_can_see_task(task_id)
  );

CREATE POLICY "Task mention acks: update own row" ON public.task_mention_acks
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Task mention acks: delete own row" ON public.task_mention_acks
  FOR DELETE USING (user_id = auth.uid());

COMMIT;
