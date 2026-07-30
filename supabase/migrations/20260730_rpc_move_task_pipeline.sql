-- rpc_move_task_pipeline
-- Moves a task to a DIFFERENT pipeline from the task editor. The plain
-- `tasks` UPDATE path can't do this safely: tasks_update_editable's WITH CHECK
-- only proves task-edit rights, it never looks at the target pipeline, and
-- pipeline_stage_history has no INSERT policy at all. So this is SECURITY
-- DEFINER and re-states both checks explicitly:
--   1. task edit rights   — mirrors tasks_update_editable
--   2. target board access — mirrors pipelines_select (visibility_permissions)
-- The task lands in the target pipeline's initial stage (there is no
-- cross-pipeline stage mapping); use rpc_import_place_task_stage afterwards to
-- put it elsewhere. Assignments are left untouched.

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
BEGIN
  SELECT id, company_id, pipeline_id, current_stage_id, created_by, manager_id
  INTO   v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_task.id IS NULL OR v_task.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- 1. mirrors tasks_update_editable
  IF NOT (
    v_is_owner
    OR v_task.created_by = v_user_id
    OR v_task.manager_id = v_user_id
    OR public.has_permission('task.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit this task';
  END IF;

  -- 2. mirrors pipelines_select
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

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id,
    from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name
  )
  VALUES (
    p_task_id, v_company_id, p_pipeline_id,
    v_task.current_stage_id, v_stage.id,
    v_user_id, v_from_name, v_stage.name
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_move_task_pipeline(uuid, uuid) TO authenticated;
