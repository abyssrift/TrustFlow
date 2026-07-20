-- rpc_import_place_task_stage
-- Places a freshly-imported task into a specific stage of its own pipeline,
-- WITHOUT the gate checks / time declarations / submissions that
-- rpc_advance_stage runs. Import fidelity only: set current_stage_id + status
-- and record the transition in history. No-op if already in the target stage.

CREATE OR REPLACE FUNCTION public.rpc_import_place_task_stage(
  p_task_id  uuid,
  p_stage_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_task       RECORD;
  v_stage_name TEXT;
  v_from_name  TEXT;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('task.create')
    OR public.has_permission('system.view_all_data')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT id, current_stage_id, pipeline_id, company_id
  INTO   v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_task.id IS NULL OR v_task.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- Target stage must belong to this task's pipeline.
  SELECT name INTO v_stage_name
  FROM   public.pipeline_stages
  WHERE  id = p_stage_id AND pipeline_id = v_task.pipeline_id;

  IF v_stage_name IS NULL THEN
    RAISE EXCEPTION 'Stage does not belong to task pipeline';
  END IF;

  IF v_task.current_stage_id IS DISTINCT FROM p_stage_id THEN
    SELECT name INTO v_from_name
    FROM   public.pipeline_stages WHERE id = v_task.current_stage_id;

    UPDATE public.tasks
    SET    current_stage_id = p_stage_id, status = v_stage_name
    WHERE  id = p_task_id;

    INSERT INTO public.pipeline_stage_history (
      task_id, company_id, pipeline_id,
      from_stage_id, to_stage_id,
      transitioned_by, from_stage_name, to_stage_name
    )
    VALUES (
      p_task_id, v_company_id, v_task.pipeline_id,
      v_task.current_stage_id, p_stage_id,
      v_user_id, v_from_name, v_stage_name
    );
  END IF;
END;
$function$;
