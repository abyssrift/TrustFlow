-- 20260615_project_management_rpc.sql
-- Add RPC for creating projects with proper permission checking
-- Add project.view, project.create, project.edit, project.delete permissions

-- 0. Seed project permission keys
INSERT INTO public.permissions (key, label, category) VALUES
    ('project.view',   'View Projects', 'projects'),
    ('project.create', 'Create Projects', 'projects'),
    ('project.edit',   'Edit Projects', 'projects'),
    ('project.delete', 'Delete Projects', 'projects')
ON CONFLICT (key) DO NOTHING;

-- 1. RPC to create projects with permission check
CREATE OR REPLACE FUNCTION public.rpc_create_project(
  p_name TEXT,
  p_color TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_expiry_date TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id UUID;
  v_user_id UUID;
  v_project RECORD;
BEGIN
  v_company_id := public.my_company_id();
  v_user_id := auth.uid();

  -- Permission check
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create projects.';
  END IF;

  -- Validate input
  IF NOT p_name OR TRIM(p_name) = '' THEN
    RAISE EXCEPTION 'Project name is required.';
  END IF;

  -- Create project
  INSERT INTO public.projects (company_id, name, color, description, expiry_date, status, created_by, created_at, updated_at)
  VALUES (v_company_id, TRIM(p_name), p_color, p_description, p_expiry_date, p_status, v_user_id, now(), now())
  RETURNING * INTO v_project;

  -- Audit log
  PERFORM public.log_event(v_company_id, v_user_id, 'project', v_project.id, 'project.created',
    jsonb_build_object('name', v_project.name));

  RETURN v_project;
END;
$$;

-- 2. RPC to get projects (with optional permission filtering)
CREATE OR REPLACE FUNCTION public.rpc_get_projects(p_include_archived BOOLEAN DEFAULT false)
RETURNS SETOF public.projects
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  RETURN QUERY
  SELECT * FROM public.projects
  WHERE company_id = v_company_id
  AND (p_include_archived OR status != 'archived')
  AND deleted_at IS NULL
  ORDER BY is_featured DESC, name ASC;
END;
$$;

-- 3. Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.rpc_create_project TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_projects TO authenticated;
