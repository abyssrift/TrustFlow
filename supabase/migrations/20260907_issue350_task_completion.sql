-- Issue #350: self-assignment and deterministic task completion RPCs.

CREATE OR REPLACE FUNCTION public.rpc_task_add_assignee(
  p_task_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task       RECORD;
  v_actor      UUID := auth.uid();
  v_is_owner   BOOLEAN;
  v_is_manager BOOLEAN;
BEGIN
  IF v_actor IS NULL OR p_user_id IS NULL OR p_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only the authenticated user can add themselves as an assignee'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.company_id, t.manager_id
    INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id
    AND t.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_task.company_id IS DISTINCT FROM public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized: task belongs to a different company'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(u.is_owner, FALSE) INTO v_is_owner
  FROM public.users u
  WHERE u.id = v_actor
    AND u.company_id = v_task.company_id;
  v_is_owner := COALESCE(v_is_owner, FALSE);
  v_is_manager := v_task.manager_id = v_actor;

  IF NOT (v_is_owner OR v_is_manager OR public.has_permission('task.assign')) THEN
    RAISE EXCEPTION 'Insufficient permission to assign this task'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  SELECT p_task_id, v_task.company_id, v_actor, v_actor
  WHERE NOT EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = p_task_id
      AND ta.assignee_user_id = v_actor
  );

  RETURN jsonb_build_object('success', true, 'task_id', p_task_id, 'assignee_user_id', v_actor);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_task_add_assignee(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_complete_task(p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task       RECORD;
  v_action_id  UUID;
  v_candidate_count INTEGER;
  v_result     JSONB;
BEGIN
  SELECT t.id, t.company_id, t.current_stage_id
    INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id
    AND t.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_task.company_id IS DISTINCT FROM public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized: task belongs to a different company'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pipeline_stages ps
    WHERE ps.id = v_task.current_stage_id
      AND ps.is_terminal = TRUE
      AND ps.terminal_type = 'success'
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_complete', true, 'task_id', p_task_id);
  END IF;

  SELECT COUNT(*)
    INTO v_candidate_count
  FROM public.pipeline_stage_actions a
  JOIN public.pipeline_stage_transitions tr ON tr.id = a.transition_id
  JOIN public.pipeline_stages target ON target.id = tr.to_stage_id
  WHERE a.stage_id = v_task.current_stage_id
    AND a.action_type = 'advance'
    AND a.is_active = TRUE
    AND target.is_terminal = TRUE
    AND target.terminal_type = 'success';

  IF v_candidate_count = 1 THEN
    SELECT a.id INTO v_action_id
    FROM public.pipeline_stage_actions a
    JOIN public.pipeline_stage_transitions tr ON tr.id = a.transition_id
    JOIN public.pipeline_stages target ON target.id = tr.to_stage_id
    WHERE a.stage_id = v_task.current_stage_id
      AND a.action_type = 'advance'
      AND a.is_active = TRUE
      AND target.is_terminal = TRUE
      AND target.terminal_type = 'success';
  END IF;

  IF v_candidate_count = 0 THEN
    RAISE EXCEPTION 'Cannot complete task: no active action reaches a success terminal stage';
  ELSIF v_candidate_count > 1 THEN
    RAISE EXCEPTION 'Cannot complete task: multiple active actions reach a success terminal stage';
  END IF;

  -- Keep all role, precondition, timer/evidence, transition, history, and hook
  -- semantics authoritative in the existing stage-action executor.
  v_result := public.rpc_execute_stage_action(p_task_id, v_action_id, '{}'::jsonb);
  RETURN COALESCE(v_result, jsonb_build_object('success', true, 'task_id', p_task_id));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_complete_task(UUID) TO authenticated;
