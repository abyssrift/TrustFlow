-- Add start_date and estimated_hours to tasks table
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS start_date       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_hours  NUMERIC(6, 2);

-- Replace rpc_create_task with new parameters
-- NOTE: Drops old overloads after this file runs (see 20260504_drop_rpc_create_task_old_overloads.sql)
CREATE OR REPLACE FUNCTION public.rpc_create_task(
  p_title                 text,
  p_description           text                      DEFAULT NULL::text,
  p_priority              text                      DEFAULT 'medium'::text,
  p_due_date              timestamptz               DEFAULT NULL::timestamptz,
  p_pipeline_id           uuid                      DEFAULT NULL::uuid,
  p_project_id            uuid                      DEFAULT NULL::uuid,
  p_manager_id            uuid                      DEFAULT NULL::uuid,
  p_category              text                      DEFAULT NULL::text,
  p_weight                bigint                    DEFAULT 0,
  p_visibility_permission text                      DEFAULT NULL::text,
  p_start_date            timestamptz               DEFAULT NULL::timestamptz,
  p_estimated_hours       numeric                   DEFAULT NULL::numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task_id           UUID;
  v_company_id        UUID;
  v_user_id           UUID := auth.uid();
  v_initial_stage     UUID;
  v_initial_name      TEXT;
  v_resolved_pipeline UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('task.create')
    OR public.has_permission('system.view_all_data')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create tasks';
  END IF;

  v_resolved_pipeline := p_pipeline_id;

  IF v_resolved_pipeline IS NULL AND p_project_id IS NOT NULL THEN
    SELECT pipeline_id INTO v_resolved_pipeline
    FROM   public.projects
    WHERE  id = p_project_id AND company_id = v_company_id;
  END IF;

  IF v_resolved_pipeline IS NULL THEN
    SELECT id INTO v_resolved_pipeline
    FROM   public.pipelines
    WHERE  company_id = v_company_id AND is_default = TRUE AND deleted_at IS NULL
    LIMIT  1;
  END IF;

  IF v_resolved_pipeline IS NOT NULL THEN
    SELECT id, name INTO v_initial_stage, v_initial_name
    FROM   public.pipeline_stages
    WHERE  pipeline_id = v_resolved_pipeline AND is_initial = TRUE
    LIMIT  1;
  END IF;

  INSERT INTO public.tasks (
    company_id, title, description, priority, due_date,
    created_by, manager_id, project_id,
    pipeline_id, current_stage_id,
    status, category, weight,
    visibility_permission, start_date, estimated_hours
  )
  VALUES (
    v_company_id, p_title, p_description, p_priority, p_due_date,
    v_user_id, COALESCE(p_manager_id, v_user_id), p_project_id,
    v_resolved_pipeline, v_initial_stage,
    COALESCE(v_initial_name, 'open'), p_category, p_weight,
    p_visibility_permission, p_start_date, p_estimated_hours
  )
  RETURNING id INTO v_task_id;

  IF v_initial_stage IS NOT NULL THEN
    INSERT INTO public.pipeline_stage_history (
      task_id, company_id, pipeline_id,
      from_stage_id, to_stage_id,
      transitioned_by, from_stage_name, to_stage_name
    )
    VALUES (
      v_task_id, v_company_id, v_resolved_pipeline,
      NULL, v_initial_stage,
      v_user_id, NULL, v_initial_name
    );
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', v_task_id, 'task.created',
    jsonb_build_object(
      'title',                 p_title,
      'priority',              p_priority,
      'pipeline',              v_resolved_pipeline,
      'visibility_permission', p_visibility_permission,
      'start_date',            p_start_date,
      'estimated_hours',       p_estimated_hours
    )
  );

  RETURN v_task_id;
END;
$function$;
