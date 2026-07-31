-- 20260731_project_hierarchy_2_rpc_template.sql
-- rpc_create_template_from_project — "save as template" capture (plan §7).
-- Snapshots a finished project's top-level tasks into project_templates.body.
--
-- Judgment calls (no explicit spec in the plan for the capture RPC's exact
-- behavior, only the body shape it must produce):
--  - Subtasks (tasks.parent_task_id) are NOT captured. The template item
--    shape (plan §4) has no parent-reference field, so there is nowhere to
--    put hierarchy even if we wanted it — top-level tasks only.
--  - due_offset_days is derived from (task.due_date - project.start_date) in
--    whole days, only when both are present. Existing projects have no
--    start_date yet, so today this is NULL for essentially every capture —
--    expected, matches plan §4's "most due dates are set manually".
--  - assignee_team_id: a task can have multiple team assignments; the
--    template item shape only holds one, so we take the earliest-assigned
--    team and drop the rest. Upgrade to an array if multi-team turns out to
--    matter.
--  - template.description/color default to the source project's, since the
--    plan gives project_templates its own description/color columns but
--    doesn't say where they come from initially.

CREATE OR REPLACE FUNCTION public.rpc_create_template_from_project(
  p_project_id UUID,
  p_name TEXT
)
RETURNS public.project_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_project    RECORD;
  v_body       JSONB;
  v_template   public.project_templates;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create templates.';
  END IF;

  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RAISE EXCEPTION 'Template name is required.';
  END IF;

  SELECT * INTO v_project
  FROM public.projects
  WHERE id = p_project_id AND company_id = v_company_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'title',            t.title,
    'description',      t.description,
    'pipeline_id',      t.pipeline_id,
    'category',         t.category,
    'priority',         t.priority,
    'weight',           t.weight,
    'estimated_hours',  t.estimated_hours,
    'due_offset_days',  CASE
                           WHEN t.due_date IS NOT NULL AND v_project.start_date IS NOT NULL
                           THEN (t.due_date::date - v_project.start_date::date)
                           ELSE NULL
                        END,
    'assignee_team_id', (
      SELECT ta.assignee_team_id
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id AND ta.assignee_team_id IS NOT NULL
      ORDER BY ta.assigned_at ASC
      LIMIT 1
    )
  ))), '[]'::jsonb)
  INTO v_body
  FROM public.tasks t
  WHERE t.project_id = p_project_id
    AND t.parent_task_id IS NULL
    AND t.deleted_at IS NULL;

  INSERT INTO public.project_templates (company_id, name, description, color, body, created_by)
  VALUES (v_company_id, TRIM(p_name), v_project.description, v_project.color, v_body, v_user_id)
  RETURNING * INTO v_template;

  PERFORM public.log_event(v_company_id, v_user_id, 'project_template', v_template.id, 'project_template.created',
    jsonb_build_object('name', v_template.name, 'source_project_id', p_project_id, 'task_count', jsonb_array_length(v_body)));

  RETURN v_template;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_template_from_project TO authenticated;
