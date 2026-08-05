-- Issue #23 check: rpc_link_task_to_pipeline / rpc_unlink_task_from_pipeline.
--
-- Not a migration -- run by hand against a DEV/STAGING database only:
--   psql "$DATABASE_URL" -f supabase/checks/20260805_task_pipeline_links_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: reuses an existing seeded non-owner user (same
-- pattern as check_projects_update_accessible.sql) but creates its own
-- throwaway pipelines/task inside that user's company. Always rolls back --
-- safe to re-run, never leaves rows behind.

BEGIN;

DO $$
DECLARE
  v_co         UUID;
  v_editor     UUID;   -- same-company user, granted task.edit
  v_home_pipe  UUID;
  v_home_stage UUID;
  v_other_pipe UUID;
  v_project_pipe UUID;
  v_task       UUID;
  v_role       UUID;
  v_link_count INTEGER;
  v_rejected   BOOLEAN := false;
BEGIN
  SELECT company_id, id INTO v_co, v_editor
  FROM public.users WHERE is_owner = false AND company_id IS NOT NULL LIMIT 1;

  IF v_co IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: no non-owner seeded user found to impersonate';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = v_editor;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_co, 'Link Check Home Pipeline', 'task') RETURNING id INTO v_home_pipe;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_home_pipe, 'Open', 0, true) RETURNING id INTO v_home_stage;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_co, 'Link Check Other Pipeline', 'task') RETURNING id INTO v_other_pipe;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_co, 'Link Check Project Pipeline', 'project') RETURNING id INTO v_project_pipe;

  INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id)
  VALUES (v_co, 'Link Check Task', v_home_pipe, v_home_stage)
  RETURNING id INTO v_task;

  -- Assert 1: a same-company user with no task.edit (and not owner/creator/
  -- manager of this task) is rejected.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN
    PERFORM public.rpc_link_task_to_pipeline(v_task, v_other_pipe);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;

  RESET ROLE;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: a user without task.edit was able to link a task';
  END IF;

  -- Assert 2: linking to the task's OWN pipeline is rejected even for a
  -- fully-permissioned user (grant task.edit now).
  INSERT INTO public.roles (company_id, name) VALUES (v_co, 'ZZ Task Editor') RETURNING id INTO v_role;
  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role, id FROM public.permissions WHERE key = 'task.edit';
  INSERT INTO public.user_roles (user_id, role_id, company_id) VALUES (v_editor, v_role, v_co);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_rejected := false;
  BEGIN
    PERFORM public.rpc_link_task_to_pipeline(v_task, v_home_pipe);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: linking a task to its own home pipeline should have been rejected';
  END IF;

  -- Assert 3: linking to a project-kind pipeline is rejected.
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_link_task_to_pipeline(v_task, v_project_pipe);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: linking a task to a project-kind pipeline should have been rejected';
  END IF;

  -- Assert 4: linking to a genuinely different task-kind pipeline succeeds
  -- and is visible via the same RLS-scoped select the client uses.
  PERFORM public.rpc_link_task_to_pipeline(v_task, v_other_pipe);

  SELECT COUNT(*) INTO v_link_count
  FROM public.task_pipeline_links WHERE task_id = v_task AND pipeline_id = v_other_pipe;
  IF v_link_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected 1 task_pipeline_links row after linking, got %', v_link_count;
  END IF;

  -- Assert 5: linking the same pair again is a harmless no-op (ON CONFLICT DO NOTHING).
  PERFORM public.rpc_link_task_to_pipeline(v_task, v_other_pipe);
  SELECT COUNT(*) INTO v_link_count
  FROM public.task_pipeline_links WHERE task_id = v_task AND pipeline_id = v_other_pipe;
  IF v_link_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: relinking the same pair should be a no-op, got % rows', v_link_count;
  END IF;

  RESET ROLE;

  -- Assert 6: unlinking removes the row.
  PERFORM public.rpc_unlink_task_from_pipeline(v_task, v_other_pipe);
  SELECT COUNT(*) INTO v_link_count
  FROM public.task_pipeline_links WHERE task_id = v_task AND pipeline_id = v_other_pipe;
  IF v_link_count <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected 0 task_pipeline_links rows after unlinking, got %', v_link_count;
  END IF;

  RAISE NOTICE 'OK: rpc_link_task_to_pipeline rejects non-editors, own-pipeline links, and project-kind targets; links/unlinks correctly and is idempotent on relink';
END $$;

ROLLBACK;
