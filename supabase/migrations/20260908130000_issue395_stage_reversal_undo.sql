-- #395: exact inverse for a user stage reversal.
--
-- rpc_advance_stage is intentionally not used here: it re-runs forward-stage
-- evidence gates and destination hooks. This function restores the exact stage
-- recorded by one reversal, only while that reversal is still the task's latest
-- history event.

DROP FUNCTION IF EXISTS public.rpc_revert_stage(uuid);

CREATE OR REPLACE FUNCTION public.rpc_revert_stage(p_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id       UUID;
  v_user_id          UUID := auth.uid();
  v_current_stage    UUID;
  v_pipeline_id      UUID;
  v_prev_stage       UUID;
  v_from_stage_name  TEXT;
  v_to_stage_name    TEXT;
  v_history_id       UUID;
BEGIN
  SELECT company_id, current_stage_id, pipeline_id
  INTO   v_company_id, v_current_stage, v_pipeline_id
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_user_id IS NULL OR v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.reverse')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT from_stage_id
  INTO   v_prev_stage
  FROM   public.pipeline_stage_history
  WHERE  task_id = p_task_id
    AND  to_stage_id = v_current_stage
    AND  pipeline_id = v_pipeline_id
    AND  is_reversal = FALSE
  ORDER BY transitioned_at DESC, id DESC
  LIMIT 1;

  IF v_prev_stage IS NULL THEN
    RAISE EXCEPTION 'Cannot revert: no prior stage found for this task in its current pipeline';
  END IF;

  UPDATE public.tasks
  SET current_stage_id = v_prev_stage, updated_at = NOW()
  WHERE id = p_task_id;

  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_current_stage;
  SELECT name INTO v_to_stage_name FROM public.pipeline_stages WHERE id = v_prev_stage;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name, is_reversal
  )
  VALUES (
    p_task_id, v_company_id, v_pipeline_id, v_current_stage, v_prev_stage,
    v_user_id, v_from_stage_name, v_to_stage_name, TRUE
  )
  RETURNING id INTO v_history_id;

  RETURN v_history_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_revert_stage(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_revert_stage(uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION public.rpc_undo_stage_reversal(
  p_task_id uuid,
  p_reversal_history_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id       UUID;
  v_user_id          UUID := auth.uid();
  v_current_stage    UUID;
  v_pipeline_id      UUID;
  v_reversal         public.pipeline_stage_history%ROWTYPE;
  v_from_stage_name  TEXT;
  v_to_stage_name    TEXT;
  v_history_id       UUID;
BEGIN
  SELECT company_id, current_stage_id, pipeline_id
  INTO v_company_id, v_current_stage, v_pipeline_id
  FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_user_id IS NULL OR v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.reverse')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT h.* INTO v_reversal
  FROM public.pipeline_stage_history h
  WHERE h.id = p_reversal_history_id
    AND h.task_id = p_task_id
    AND h.pipeline_id = v_pipeline_id
    AND h.is_reversal = TRUE
    AND h.to_stage_id = v_current_stage;

  IF v_reversal.id IS NULL THEN
    RAISE EXCEPTION 'Cannot undo: reversal is not the current task transition';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pipeline_stage_history newer
    WHERE newer.task_id = p_task_id
      AND (newer.transitioned_at, newer.id) > (v_reversal.transitioned_at, v_reversal.id)
  ) THEN
    RAISE EXCEPTION 'Cannot undo: a newer stage transition already exists';
  END IF;

  IF v_reversal.from_stage_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages s
    WHERE s.id = v_reversal.from_stage_id AND s.pipeline_id = v_pipeline_id
  ) THEN
    RAISE EXCEPTION 'Cannot undo: reversal source stage is no longer valid';
  END IF;

  UPDATE public.tasks
  SET current_stage_id = v_reversal.from_stage_id, updated_at = NOW()
  WHERE id = p_task_id AND current_stage_id = v_reversal.to_stage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot undo: task stage changed while undoing';
  END IF;

  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_reversal.to_stage_id;
  SELECT name INTO v_to_stage_name FROM public.pipeline_stages WHERE id = v_reversal.from_stage_id;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name, is_reversal
  )
  VALUES (
    p_task_id, v_company_id, v_pipeline_id, v_reversal.to_stage_id,
    v_reversal.from_stage_id, v_user_id, v_from_stage_name, v_to_stage_name, TRUE
  )
  RETURNING id INTO v_history_id;

  RETURN v_history_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_undo_stage_reversal(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_undo_stage_reversal(uuid, uuid) FROM anon, public;
