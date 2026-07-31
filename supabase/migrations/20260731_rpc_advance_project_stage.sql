-- #172 Projects P2 -- rpc_advance_project_stage.
--
-- Mirrors public.rpc_advance_stage (the existing task stage-move RPC --
-- see 20260624_pipeline_assignment_modes.sql) for projects: same auth shape,
-- same owner-bypass on transition-path validation, same history write.
-- Deliberately drops the task-only pieces (submission/attachment gates,
-- linked-pipeline child spawn, reassign_on_entry automation) -- projects
-- have no submissions and stage movement is manual-only in v1 (plan doc
-- #142 sec 5: auto-advance is a pipeline_automations follow-on, not v1).

CREATE OR REPLACE FUNCTION public.rpc_advance_project_stage(
  p_project_id UUID,
  p_to_stage_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      UUID;
  v_user_id         UUID := auth.uid();
  v_current_stage   UUID;
  v_pipeline_id     UUID;
  v_target_pipe_id  UUID;
  v_from_stage_name TEXT;
  v_to_stage_name   TEXT;
BEGIN
  -- 1. Context & authorization
  SELECT company_id, current_stage_id, pipeline_id
  INTO   v_company_id, v_current_stage, v_pipeline_id
  FROM   public.projects
  WHERE  id = p_project_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;

  -- System/cron operations (v_user_id IS NULL) are allowed through, same as
  -- rpc_advance_stage.
  IF v_user_id IS NOT NULL AND v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Target stage must exist and belong to a project-kind pipeline.
  SELECT ps.pipeline_id INTO v_target_pipe_id
  FROM public.pipeline_stages ps
  WHERE ps.id = p_to_stage_id;

  IF v_target_pipe_id IS NULL THEN
    RAISE EXCEPTION 'Target stage not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE p.id = v_target_pipe_id AND p.subject_kind = 'project'
  ) THEN
    RAISE EXCEPTION 'Target stage does not belong to a project pipeline';
  END IF;

  -- 3. Transition path validation (owners bypass; skipped on first
  -- placement when the project has no current stage yet).
  IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND is_owner = TRUE) THEN
    IF v_current_stage IS NOT NULL AND v_pipeline_id = v_target_pipe_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.pipeline_stage_transitions
        WHERE from_stage_id = v_current_stage AND to_stage_id = p_to_stage_id
      ) THEN
        RAISE EXCEPTION 'Invalid stage transition path';
      END IF;
    END IF;
  END IF;

  -- 4. Update project
  UPDATE public.projects
  SET    current_stage_id = p_to_stage_id,
         pipeline_id      = v_target_pipe_id,
         updated_at       = NOW()
  WHERE  id = p_project_id;

  -- 5. History -- this is what makes "days in current stage" derivable
  -- later without any extra bookkeeping column.
  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_current_stage;
  SELECT name INTO v_to_stage_name   FROM public.pipeline_stages WHERE id = p_to_stage_id;

  INSERT INTO public.project_stage_history (
    project_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name
  )
  VALUES (
    p_project_id, v_company_id, v_target_pipe_id, v_current_stage, p_to_stage_id,
    v_user_id, v_from_stage_name, v_to_stage_name
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_advance_project_stage(UUID, UUID) TO authenticated;
