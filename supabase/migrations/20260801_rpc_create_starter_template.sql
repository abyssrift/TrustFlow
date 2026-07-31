-- 20260801_rpc_create_starter_template.sql
-- Starter template library (dead-end fix, docs/PROJECT_HIERARCHY_PLAN.md §2/§4/§7).
--
-- BulkCreateProjectsSheet requires an existing project_templates row, and the
-- only capture path was rpc_create_template_from_project — which needs a
-- FINISHED PROJECT to copy from. A brand-new company has zero projects, so
-- the feature was unreachable on day one. Fix: lib/starterTemplates.ts ships
-- a curated, code-level library of researched starters (NOT database rows,
-- NOT a global table — see that file's header). Picking one calls this RPC
-- to materialize it into a real, ordinary, editable project_templates row
-- for the caller's company. After that it behaves exactly like a template
-- saved from a finished project — nothing downstream changes.
--
-- Why this needs an RPC, not a client-side `.insert()`: project_templates
-- has RLS enabled with only a SELECT policy
-- (20260731_project_hierarchy_4_rls_placeholder.sql is explicit that "all
-- writes go through the SECURITY DEFINER RPCs" pending the open project-
-- visibility question in plan §11). A raw insert from supabase-js is denied
-- by default. This function mirrors rpc_create_template_from_project exactly
-- — same permission check (is_owner OR project.create), same plain insert
-- shape — just sourced from a client-supplied body instead of copied from an
-- existing project. No RLS change, no new table, no company_id IS NULL case.
CREATE OR REPLACE FUNCTION public.rpc_create_starter_template(
  p_name        TEXT,
  p_description TEXT,
  p_color       TEXT,
  p_body        JSONB
)
RETURNS public.project_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
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

  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'array' OR jsonb_array_length(p_body) = 0 THEN
    RAISE EXCEPTION 'At least one task is required.';
  END IF;

  INSERT INTO public.project_templates (company_id, name, description, color, body, created_by)
  VALUES (v_company_id, TRIM(p_name), p_description, p_color, p_body, v_user_id)
  RETURNING * INTO v_template;

  PERFORM public.log_event(v_company_id, v_user_id, 'project_template', v_template.id, 'project_template.created',
    jsonb_build_object('name', v_template.name, 'source', 'starter_library', 'task_count', jsonb_array_length(p_body)));

  RETURN v_template;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_starter_template TO authenticated;
