-- FileHub file-visibility #163 Phase 1 (additive + inert): per-pipeline
-- configurable policy for who can see a task's files, plus the single function
-- that will become the source of truth. Nothing references the function yet —
-- table/storage RLS and the FileHub RPCs get switched to it in Phase 2. See
-- docs/FILEHUB_FILE_VISIBILITY_PLAN.md.

-- Config lives on the pipeline. Existing rows fill with the default preset.
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS file_visibility jsonb NOT NULL
  DEFAULT '{"preset":"task_members"}'::jsonb;

-- Single source of truth for FILE access (distinct from task_accessible, which
-- governs task-detail visibility). Floor: company owner + task creator/manager
-- can always see the task's files, regardless of the pipeline policy.
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

  -- Floor: owner / creator / manager always.
  IF COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = v_uid), false)
     OR v_task.created_by = v_uid
     OR v_task.manager_id = v_uid THEN
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
