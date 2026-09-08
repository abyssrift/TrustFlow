-- Issue #350 self-check. Transaction-wrapped; always rolls back.
-- Run with: psql "$DATABASE_URL" -f supabase/checks/20260907_issue350_task_completion_check.sql

BEGIN;

DO $$
DECLARE
  v_company UUID;
  v_owner UUID;
  v_worker UUID;
  v_other UUID;
  v_foreign_company UUID;
  v_foreign_pipeline UUID;
  v_foreign_stage UUID;
  v_foreign_task UUID;
  v_team UUID;
  v_pipe UUID;
  v_open UUID;
  v_empty UUID;
  v_amb_transition UUID;
  v_amb_action UUID;
  v_nonadvance_action UUID;
  v_done UUID;
  v_task UUID;
  v_transition UUID;
  v_action UUID;
  v_role UUID;
  v_before_assignments INTEGER;
  v_after_assignments INTEGER;
  v_before_history INTEGER;
  v_after_history INTEGER;
  v_rejected BOOLEAN;
BEGIN
  SELECT u.company_id, u.id INTO v_company, v_owner
  FROM public.users u
  WHERE u.is_owner = TRUE AND u.company_id IS NOT NULL AND u.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.users u2
      WHERE u2.company_id = u.company_id AND u2.id <> u.id
        AND u2.is_owner = FALSE AND u2.deleted_at IS NULL
    )
  ORDER BY u.company_id
  LIMIT 1;
  IF v_company IS NULL THEN RAISE EXCEPTION 'CHECK SKIPPED: no seeded owner/company'; END IF;

  SELECT u.id INTO v_worker FROM public.users u
  WHERE u.company_id = v_company AND u.id <> v_owner AND u.is_owner = FALSE AND u.deleted_at IS NULL LIMIT 1;
  v_other := v_owner;
  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need one same-company non-owner user';
  END IF;

  INSERT INTO public.teams (company_id, name) VALUES (v_company, 'I350 preserved team') RETURNING id INTO v_team;
  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'I350 task pipeline', 'task') RETURNING id INTO v_pipe;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipe, 'I350 open', 1, TRUE) RETURNING id INTO v_open;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
  VALUES (v_pipe, 'I350 done', 2, TRUE, 'success') RETURNING id INTO v_done;
  INSERT INTO public.pipeline_stage_transitions (from_stage_id, to_stage_id, label)
  VALUES (v_open, v_done, 'I350 complete') RETURNING id INTO v_transition;
  INSERT INTO public.pipeline_stage_actions
    (stage_id, action_type, label, style, required_role, position, is_active, transition_id)
  VALUES (v_open, 'advance', 'I350 complete', 'primary', 'assignee', 1, TRUE, v_transition)
  RETURNING id INTO v_action;
  INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id, created_by, manager_id)
  VALUES (v_company, 'I350 task', v_pipe, v_open, v_owner, v_owner) RETURNING id INTO v_task;

  SELECT u.company_id INTO v_foreign_company
  FROM public.users u
  WHERE u.company_id IS NOT NULL AND u.company_id <> v_company
  GROUP BY u.company_id
  ORDER BY u.company_id
  LIMIT 1;
  SELECT p.id, s.id INTO v_foreign_pipeline, v_foreign_stage
  FROM public.pipelines p
  JOIN public.pipeline_stages s ON s.pipeline_id = p.id AND s.is_initial = TRUE
  WHERE p.company_id = v_foreign_company AND p.subject_kind = 'task'
  LIMIT 1;
  IF v_foreign_pipeline IS NULL OR v_foreign_stage IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: no foreign-company task pipeline fixture';
  END IF;
  INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id, created_by, manager_id)
  VALUES (v_foreign_company, 'I350 foreign task', v_foreign_pipeline, v_foreign_stage, v_owner, v_owner)
  RETURNING id INTO v_foreign_task;

  DELETE FROM public.user_roles WHERE user_id = v_worker;

  PERFORM set_config('request.jwt.claim.sub', v_worker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_worker::text, 'role', 'authenticated')::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_task_add_assignee(v_task, v_worker);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: assignment succeeded without task.assign or owner/manager authority'; END IF;

  INSERT INTO public.roles (company_id, name) VALUES (v_company, 'I350 task assigner') RETURNING id INTO v_role;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role, p.id FROM public.permissions p WHERE p.key = 'task.assign';
  INSERT INTO public.user_roles (user_id, role_id, company_id) VALUES (v_worker, v_role, v_company);

  INSERT INTO public.task_assignments (task_id, company_id, assignee_team_id, assigned_by)
  VALUES (v_task, v_company, v_team, v_owner);
  SELECT COUNT(*) INTO v_before_assignments FROM public.task_assignments WHERE task_id = v_task;

  PERFORM set_config('request.jwt.claim.sub', v_worker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_worker::text, 'role', 'authenticated')::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_task_add_assignee(v_task, v_other);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: self-only assignee guard'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.rpc_task_add_assignee(v_foreign_task, v_worker);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: cross-company task was accepted'; END IF;

  PERFORM public.rpc_task_add_assignee(v_task, v_worker);
  PERFORM public.rpc_task_add_assignee(v_task, v_worker);
  SELECT COUNT(*) INTO v_after_assignments FROM public.task_assignments WHERE task_id = v_task;
  IF v_after_assignments <> v_before_assignments + 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected one additive/idempotent user row and preserved team row (%, %)', v_before_assignments, v_after_assignments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.task_assignments WHERE task_id = v_task AND assignee_team_id = v_team)
     OR NOT EXISTS (SELECT 1 FROM public.task_assignments WHERE task_id = v_task AND assignee_user_id = v_worker) THEN
    RAISE EXCEPTION 'CHECK FAILED: existing team or new user assignment was not preserved';
  END IF;

  SELECT COUNT(*) INTO v_before_history FROM public.pipeline_stage_history WHERE task_id = v_task;
  PERFORM public.rpc_complete_task(v_task);
  IF (SELECT current_stage_id FROM public.tasks WHERE id = v_task) IS DISTINCT FROM v_done THEN
    RAISE EXCEPTION 'CHECK FAILED: completion did not reach success terminal';
  END IF;
  SELECT COUNT(*) INTO v_after_history FROM public.pipeline_stage_history WHERE task_id = v_task;
  IF v_after_history <> v_before_history + 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: completion did not write exactly one stage history row';
  END IF;
  PERFORM public.rpc_complete_task(v_task);
  IF (SELECT COUNT(*) FROM public.pipeline_stage_history WHERE task_id = v_task) <> v_after_history THEN
    RAISE EXCEPTION 'CHECK FAILED: already-success completion was not idempotent';
  END IF;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipe, 'I350 no candidate', 3) RETURNING id INTO v_empty;
  UPDATE public.tasks SET current_stage_id = v_empty WHERE id = v_task;
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_complete_task(v_task);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: no-candidate completion was accepted'; END IF;

  v_amb_transition := v_transition;
  INSERT INTO public.pipeline_stage_actions
    (stage_id, action_type, label, style, required_role, position, is_active, transition_id)
  VALUES (v_open, 'advance', 'I350 ambiguous', 'primary', 'assignee', 2, TRUE, v_amb_transition)
  RETURNING id INTO v_amb_action;
  INSERT INTO public.pipeline_stage_actions
    (stage_id, action_type, label, style, required_role, position, is_active, transition_id)
  VALUES (v_open, 'review_approve', 'I350 non-advance', 'primary', 'any', 3, TRUE, v_amb_transition)
  RETURNING id INTO v_nonadvance_action;
  UPDATE public.tasks SET current_stage_id = v_open WHERE id = v_task;
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_complete_task(v_task);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: ambiguous completion was accepted'; END IF;
  DELETE FROM public.pipeline_stage_actions WHERE id = v_amb_action;
  DELETE FROM public.pipeline_stage_actions WHERE id = v_action;
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_complete_task(v_task);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: non-advance success action was treated as a completion candidate'; END IF;
  DELETE FROM public.pipeline_stage_actions WHERE id = v_nonadvance_action;
  INSERT INTO public.pipeline_stage_actions
    (stage_id, action_type, label, style, required_role, position, is_active, transition_id)
  VALUES (v_open, 'advance', 'I350 complete restored', 'primary', 'assignee', 1, TRUE, v_transition)
  RETURNING id INTO v_action;

  -- Required-role gate remains authoritative because completion delegates to executor.
  DELETE FROM public.pipeline_stage_history WHERE task_id = v_task;
  DELETE FROM public.task_assignments WHERE task_id = v_task AND assignee_user_id = v_worker;
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_complete_task(v_task);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'CHECK FAILED: executor assignee gate was bypassed'; END IF;

  RAISE NOTICE 'OK: self-only/permission/company checks, additive idempotency/preservation, deterministic completion, executor gates, and history passed';
END $$;

ROLLBACK;
