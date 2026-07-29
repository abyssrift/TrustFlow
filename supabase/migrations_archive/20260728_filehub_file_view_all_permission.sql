-- Issue #163: a bypass permission that overrides per-pipeline file visibility.
-- Holders (owners, senior managers) see EVERY task's files in their company,
-- regardless of the pipeline's file_visibility policy. Seeded onto the Owner +
-- Admin system roles (mirrors 20260719_filehub_bin_empty_permission.sql).
--
-- fn_task_file_accessible is the single source of truth for file access (table
-- RLS + storage RLS + FileHub RPCs), so the bypass lives in its floor and
-- nothing else needs touching. Still company-scoped: the task lookup above the
-- floor already confirms same-company, so this never crosses tenants.
INSERT INTO public.permissions (key, label, description, category) VALUES
    ('filehub:view_all_files', 'View All Task Files', 'Bypass per-pipeline file-visibility rules and view every task''s files across the company.', 'filehub')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = true
  AND r.name IN ('Owner', 'Admin')
  AND p.key = 'filehub:view_all_files'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_task_file_accessible(p_task_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_company   uuid := public.my_company_id();
  v_task      record;
  v_cfg       jsonb;
  v_preset    text;
  v_assignees boolean;
  v_reviewers boolean;
BEGIN
  SELECT t.id, t.created_by, t.manager_id, t.pipeline_id, t.category
    INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id
    AND t.deleted_at IS NULL
    AND t.company_id = v_company;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Floor: owner / creator / manager, plus the bypass permission, always.
  IF COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = v_uid), false)
     OR v_task.created_by = v_uid
     OR v_task.manager_id = v_uid
     OR public.has_permission('filehub:view_all_files') THEN
    RETURN true;
  END IF;

  -- Pipeline policy, with an optional per-category override.
  SELECT p.file_visibility INTO v_cfg FROM public.pipelines p WHERE p.id = v_task.pipeline_id;
  v_cfg := COALESCE(v_cfg, '{"preset":"task_members"}'::jsonb);
  IF v_task.category IS NOT NULL
     AND jsonb_typeof(v_cfg -> 'categories') = 'object'
     AND (v_cfg -> 'categories') ? v_task.category THEN
    v_cfg := v_cfg -> 'categories' -> v_task.category;
  END IF;

  -- Expand preset → effective flags.
  v_preset := COALESCE(v_cfg ->> 'preset', 'custom');
  IF v_preset = 'company' THEN
    RETURN true;  -- any company member (task already confirmed same-company above)
  ELSIF v_preset = 'task_members' THEN
    v_assignees := true;  v_reviewers := true;
  ELSIF v_preset = 'submitters_reviewers' THEN
    v_assignees := false; v_reviewers := true;
  ELSE  -- custom
    v_assignees := COALESCE((v_cfg ->> 'assignees')::boolean, false);
    v_reviewers := COALESCE((v_cfg ->> 'reviewers')::boolean, false);
  END IF;

  -- Task assignees (direct user or via team).
  IF v_assignees AND EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = v_task.id
      AND ( ta.assignee_user_id = v_uid
            OR ta.assignee_team_id IN (
              SELECT tm.team_id FROM public.team_members tm
              WHERE tm.user_id = v_uid AND tm.removed_at IS NULL
            ) )
  ) THEN
    RETURN true;
  END IF;

  -- Submission reviewers.
  IF v_reviewers AND public.has_permission('submission.review') THEN
    RETURN true;
  END IF;

  -- Explicit people.
  IF jsonb_typeof(v_cfg -> 'users') = 'array' AND (v_cfg -> 'users') ? v_uid::text THEN
    RETURN true;
  END IF;

  -- Roles (direct or team-inherited), mirroring has_permission's role sourcing.
  IF jsonb_typeof(v_cfg -> 'roles') = 'array' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.revoked_at IS NULL
        AND (v_cfg -> 'roles') ? ur.role_id::text
    ) OR EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.team_roles tr ON tr.team_id = tm.team_id
      WHERE tm.user_id = v_uid AND tm.removed_at IS NULL
        AND (v_cfg -> 'roles') ? tr.role_id::text
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_task_file_accessible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_task_file_accessible(uuid) TO authenticated;
