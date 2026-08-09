-- Issue #23: Shared Tasks (visible-only cross-pipeline linking).
--
-- A task keeps exactly one owning pipeline_id/current_stage_id (unchanged --
-- this is NOT independent per-pipeline progress tracking, see the design
-- doc). What this adds is the ability to additionally link a task onto
-- OTHER task-kind pipelines' boards as a read-only reference card, so
-- another team can see it's relevant to them without duplicating it
-- (spawn_recursive_task's child-task creation) or moving it out of its
-- real home (rpc_move_task_pipeline).

-- ============================================================
-- Section 1: task_pipeline_links table
-- ============================================================
CREATE TABLE public.task_pipeline_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  linked_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Both FKs CASCADE off tasks/companies, so rpc_platform_delete_company needs no
-- edit -- this table sweeps automatically on company/task/pipeline deletion,
-- same convention as pipeline_assignment_pool.

CREATE UNIQUE INDEX task_pipeline_links_uq ON public.task_pipeline_links (task_id, pipeline_id);
CREATE INDEX task_pipeline_links_pipeline_idx ON public.task_pipeline_links (pipeline_id);
CREATE INDEX task_pipeline_links_task_idx ON public.task_pipeline_links (task_id);

ALTER TABLE public.task_pipeline_links ENABLE ROW LEVEL SECURITY;

-- Scoping to company_id alone isn't enough: tasks_select_visibility further
-- restricts a task to its creator/manager/assignee when the owning pipeline
-- is task_visibility_mode = 'assigned_only', and this table must not leak a
-- task's existence (or which pipelines it's linked to) past that. Rather than
-- duplicate that visibility logic here, the EXISTS composes with it directly:
-- Postgres evaluates the subquery as the querying role, so tasks' own RLS
-- policy filters it for us.
CREATE POLICY "TaskPipelineLinks: select by company" ON public.task_pipeline_links
  FOR SELECT USING (
    company_id = public.my_company_id()
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_pipeline_links.task_id)
  );
-- No INSERT/UPDATE/DELETE policy -- all writes go through the SECURITY DEFINER
-- RPCs below, same convention as pipeline_assignment_pool/task_assignments.

-- ============================================================
-- Section 2: rpc_link_task_to_pipeline
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_link_task_to_pipeline(p_task_id uuid, p_pipeline_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      UUID;
  v_task_pipeline_id UUID;
  v_user_id         UUID := auth.uid();
  v_is_owner        BOOLEAN;
  v_is_creator      BOOLEAN;
  v_is_manager      BOOLEAN;
  v_target_company  UUID;
  v_target_kind     TEXT;
BEGIN
  -- COALESCE matters: manager_id is commonly NULL (unmanaged task), and
  -- `manager_id = v_user_id` against a NULL evaluates to NULL rather than
  -- FALSE. Left uncoalesced, that NULL poisons the whole OR chain below to
  -- NULL, and `IF NOT NULL` doesn't raise in PL/pgSQL -- silently letting
  -- anyone bypass the task.edit check on any task with no manager assigned.
  SELECT company_id, pipeline_id, COALESCE(created_by = v_user_id, FALSE), COALESCE(manager_id = v_user_id, FALSE)
  INTO   v_company_id, v_task_pipeline_id, v_is_creator, v_is_manager
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  v_is_owner := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  IF NOT (v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.edit')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_pipeline_id = v_task_pipeline_id THEN
    RAISE EXCEPTION 'Task is already in this pipeline';
  END IF;

  SELECT company_id, subject_kind INTO v_target_company, v_target_kind
  FROM public.pipelines WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_target_company IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
  IF v_target_company != v_company_id THEN RAISE EXCEPTION 'Pipeline is not in this company'; END IF;
  IF v_target_kind != 'task' THEN RAISE EXCEPTION 'Can only link to a task-kind pipeline'; END IF;

  INSERT INTO public.task_pipeline_links (task_id, pipeline_id, company_id, linked_by)
  VALUES (p_task_id, p_pipeline_id, v_company_id, v_user_id)
  ON CONFLICT (task_id, pipeline_id) DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_link_task_to_pipeline(uuid, uuid) TO authenticated;

-- ============================================================
-- Section 3: rpc_unlink_task_from_pipeline
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_unlink_task_from_pipeline(p_task_id uuid, p_pipeline_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_is_owner   BOOLEAN;
  v_is_creator BOOLEAN;
  v_is_manager BOOLEAN;
BEGIN
  -- See rpc_link_task_to_pipeline: COALESCE is required or a NULL manager_id
  -- silently bypasses the task.edit check via NULL-poisoned OR/NOT logic.
  SELECT company_id, COALESCE(created_by = v_user_id, FALSE), COALESCE(manager_id = v_user_id, FALSE)
  INTO   v_company_id, v_is_creator, v_is_manager
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  v_is_owner := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  IF NOT (v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.edit')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  DELETE FROM public.task_pipeline_links
  WHERE task_id = p_task_id AND pipeline_id = p_pipeline_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_unlink_task_from_pipeline(uuid, uuid) TO authenticated;

-- ============================================================
-- Section 4: rpc_move_task_pipeline -- clear a stale link on move
-- ============================================================
-- rpc_link_task_to_pipeline refuses to link a task to its own home pipeline,
-- but moving a task's home pipeline (this RPC, e.g. via EditTaskModal) is a
-- separate path that had no reason to know about task_pipeline_links before
-- this table existed. Without this, a task linked onto pipeline X and later
-- moved to X as its new home would keep a link row pointing at itself.
-- Full redefinition (not a modification) to match this repo's
-- one-CREATE-OR-REPLACE-per-migration convention -- see 20260730_rpc_move_task_pipeline.sql
-- and its 20260730_move_task_pipeline_analytics_fixes.sql follow-up for the
-- rest of this function's history.
CREATE OR REPLACE FUNCTION public.rpc_move_task_pipeline(
  p_task_id     uuid,
  p_pipeline_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID    := public.my_company_id();
  v_user_id    UUID    := auth.uid();
  v_is_owner   BOOLEAN := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  v_task       RECORD;
  v_stage      RECORD;
  v_from_name  TEXT;
  v_timer_by   TEXT;
BEGIN
  SELECT id, company_id, pipeline_id, current_stage_id, created_by, manager_id, title
  INTO   v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_task.id IS NULL OR v_task.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- mirrors tasks_update_editable. COALESCE matters: pre-existing bug found
  -- while redefining this function for the link-cleanup above -- an
  -- unmanaged task (manager_id IS NULL) turned `v_task.manager_id =
  -- v_user_id` into NULL, poisoning the OR chain to NULL and silently
  -- passing anyone through `IF NOT NULL`, which PL/pgSQL treats as false.
  IF NOT (
    v_is_owner
    OR v_task.created_by = v_user_id
    OR COALESCE(v_task.manager_id = v_user_id, FALSE)
    OR public.has_permission('task.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit this task';
  END IF;

  -- mirrors pipelines_select
  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE  p.id = p_pipeline_id
      AND  p.company_id = v_company_id
      AND  p.deleted_at IS NULL
      AND (
        v_is_owner
        OR public.has_permission('system.view_all_data')
        OR p.visibility_permissions = '{}'::text[]
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id    = v_user_id
            AND ur.company_id = v_company_id
            AND ur.revoked_at IS NULL
            AND (ur.role_id)::text = ANY (p.visibility_permissions)
        )
      )
  ) THEN
    RAISE EXCEPTION 'No access to that pipeline';
  END IF;

  IF v_task.pipeline_id IS NOT DISTINCT FROM p_pipeline_id THEN RETURN; END IF;

  -- Someone is timing this task right now: their session would end up banked
  -- against a stage on a board the task no longer sits in.
  SELECT COALESCE(u.full_name, 'Someone')
  INTO   v_timer_by
  FROM   public.task_work_sessions ws
  LEFT   JOIN public.users u ON u.id = ws.user_id
  WHERE  ws.task_id = p_task_id AND ws.status = 'active'
  LIMIT  1;

  IF v_timer_by IS NOT NULL THEN
    RAISE EXCEPTION 'Concurrency Lock: % has an active timer on "%". Stop it before moving this task.',
      v_timer_by, v_task.title;
  END IF;

  SELECT id, name INTO v_stage
  FROM   public.pipeline_stages
  WHERE  pipeline_id = p_pipeline_id
  ORDER  BY is_initial DESC NULLS LAST, position ASC
  LIMIT  1;

  IF v_stage.id IS NULL THEN
    RAISE EXCEPTION 'Target pipeline has no stages';
  END IF;

  SELECT name INTO v_from_name FROM public.pipeline_stages WHERE id = v_task.current_stage_id;

  UPDATE public.tasks
  SET    pipeline_id = p_pipeline_id, current_stage_id = v_stage.id, status = v_stage.name
  WHERE  id = p_task_id;

  -- New home pipeline can't also be a link target -- drop it if one exists.
  DELETE FROM public.task_pipeline_links
  WHERE task_id = p_task_id AND pipeline_id = p_pipeline_id;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id,
    from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name
  )
  VALUES (
    p_task_id, v_company_id, p_pipeline_id,
    NULL, v_stage.id,   -- from_stage_id NULL: the prior stage is on another board
    v_user_id, v_from_name, v_stage.name
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_move_task_pipeline(uuid, uuid) TO authenticated;
