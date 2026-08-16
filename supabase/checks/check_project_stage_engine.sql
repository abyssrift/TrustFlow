-- Runnable check for issue #142 Phase 12 (plan §20): a project stage change
-- actually DOES something -- it notifies, and an automation can move a project
-- on its own.  Covers 20260803_project_stage_engine.sql.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres \
--     -d postgres -f - < supabase/checks/check_project_stage_engine.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates two throwaway project pipelines, seven
-- projects and two tasks in an existing seeded company, reusing real
-- users/roles and never inventing auth.users rows (same convention as every
-- other check in this folder). Always rolls back -- safe to re-run, leaves
-- nothing behind.
--
-- It also DISABLEs trg_dispatch_notification_event for the transaction. That
-- trigger pg_net-POSTs every notification_event to a HARDCODED PRODUCTION
-- Edge Function URL (20260502_notification_engine_phase3.sql). A check that
-- emits events must not be the thing that pages a real firm. DDL is
-- transactional, so the ROLLBACK puts it back.
--
-- Proves:
--   1. Advancing a project's stage EMITS a notification event, with the
--      from/to stage ids and a resolved recipient list in the payload, and an
--      active notification_rule exists to consume it.
--   2. Three actors, one predicate. The project OWNER and a user ASSIGNED a
--      task in it are in the recipient list; a user with NO access is NOT.
--      Every one of the three is cross-checked against
--      fn_project_accessible() evaluated AS THAT USER -- so the list is
--      proven to BE the predicate, not merely to agree with it today.
--      A project.view_all holder is included via the same route.
--   3. An OVERDUE project sitting in an automated stage advances when
--      rpc_process_automations() runs, logs its execution, and emits the
--      stage-change notification on the way.
--   4. Nothing else moves: a project in a stage with NO automation stays put,
--      and an automated stage does not move a project that is not overdue.
--      The unchanged TASK branch still advances an overdue task, so the
--      subject_kind split did not cost the old behaviour.
--   4b. check_interval_minutes and buffer_minutes (20260816 fix) actually
--      gate: a rule that just ran (last_run_at = NOW()) does not re-fire an
--      otherwise-overdue project on the same tick, and an overdue project
--      inside its configured buffer does not fire while one past the buffer
--      does.
--   5. fn_project_stage_notify_recipients restores the caller's JWT claims.
--      It impersonates candidates to evaluate the predicate; leaking that
--      into the surrounding transaction would silently re-authorise
--      everything after a stage move.

BEGIN;

ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;

DO $$
DECLARE
  v_company   UUID;
  v_creator   UUID;   -- is_owner => holds project.view_all implicitly
  v_pool      UUID[];
  v_zero      UUID;   -- no access at all
  v_assigned  UUID;   -- assigned a task in the project
  v_powner    UUID;   -- projects.owner_id
  v_pipe      UUID;
  v_stage_a   UUID;
  v_stage_b   UUID;
  v_stage_c   UUID;
  v_p_notify  UUID;
  v_p_auto    UUID;
  v_p_still   UUID;
  v_p_future  UUID;
  v_task      UUID;
  v_auto      UUID;
  v_task_pipe UUID;
  v_ts_a      UUID;
  v_ts_b      UUID;
  v_task_auto UUID;
  v_hot_task  UUID;
  v_evt       RECORD;
  v_recips    UUID[];
  v_n         INT;
  v_claims    TEXT;
  v_cadence_pipe UUID;
  v_cs_a      UUID;
  v_cs_b      UUID;
  v_cs_c      UUID;
  v_auto_gated     UUID;
  v_auto_buffered  UUID;
  v_p_gated   UUID;
  v_p_buf_no  UUID;   -- overdue by less than the configured buffer
  v_p_buf_yes UUID;   -- overdue by more than the configured buffer
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────
  SELECT u.company_id INTO v_company
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id AND c.deleted_at IS NULL
  WHERE u.is_owner = false AND u.deleted_at IS NULL AND u.is_active
  GROUP BY u.company_id
  HAVING COUNT(*) >= 3
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Need a company with 3 non-owner users -- run this against a seeded dev DB, not prod.';
  END IF;

  SELECT id INTO v_creator FROM public.users
  WHERE company_id = v_company AND is_owner = true AND deleted_at IS NULL LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No owner user in company %.', v_company;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT u.id FROM public.users u
    WHERE u.company_id = v_company AND u.is_owner = false
      AND u.deleted_at IS NULL AND u.is_active
    ORDER BY u.id LIMIT 3
  ) x;
  v_zero := v_pool[1]; v_assigned := v_pool[2]; v_powner := v_pool[3];

  -- Strip every role from the three test users so their access can only come
  -- from ownership or assignment. Otherwise a seeded project.view_all would
  -- make all three visible and the negative case would prove nothing.
  DELETE FROM public.user_roles WHERE user_id = ANY (v_pool);
  DELETE FROM public.team_members WHERE user_id = ANY (v_pool);

  -- A project-kind pipeline: A -> B, with the transition row
  -- rpc_advance_project_stage validates against. Stage C is a SIDING: no
  -- automation sources from it and none targets it, so a project parked
  -- there must still be there afterwards. It has to be a distinct stage --
  -- parking the control project in stage B would hide a processor that
  -- moves everything, because moving it to B is a no-op.
  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'PSE Selfcheck Project Pipeline', 'project')
  RETURNING id INTO v_pipe;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipe, 'PSE Intake', 1, true) RETURNING id INTO v_stage_a;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal)
  VALUES (v_pipe, 'PSE Review', 2, true) RETURNING id INTO v_stage_b;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipe, 'PSE Siding', 3) RETURNING id INTO v_stage_c;
  INSERT INTO public.pipeline_stage_transitions (from_stage_id, to_stage_id)
  VALUES (v_stage_a, v_stage_b);

  -- The notification subject: owned by v_powner, one task assigned to
  -- v_assigned, and v_zero touching neither.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id)
  VALUES (v_company, 'PSE Notify Project', v_creator, v_powner, v_pipe, v_stage_a)
  RETURNING id INTO v_p_notify;

  INSERT INTO public.tasks (company_id, project_id, title, created_by)
  VALUES (v_company, v_p_notify, 'PSE assigned task', v_creator)
  RETURNING id INTO v_task;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task, v_company, v_assigned, v_creator);

  -- ── 1. A stage change emits an event ──────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_creator::text, 'role', 'authenticated')::text, true);

  PERFORM public.rpc_advance_project_stage(v_p_notify, v_stage_b);

  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.stage_transition' AND entity_id = v_p_notify;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: expected exactly 1 project.stage_transition event, got %', v_n;
  END IF;

  SELECT * INTO v_evt FROM public.notification_events
  WHERE event_type = 'project.stage_transition' AND entity_id = v_p_notify;

  IF v_evt.entity_type <> 'project' THEN
    RAISE EXCEPTION 'CHECK FAILED: entity_type is %, expected project', v_evt.entity_type;
  END IF;
  IF v_evt.actor_id IS DISTINCT FROM v_creator THEN
    RAISE EXCEPTION 'CHECK FAILED: actor_id not recorded (% vs %)', v_evt.actor_id, v_creator;
  END IF;
  IF (v_evt.payload->>'from_stage_id')::uuid IS DISTINCT FROM v_stage_a
     OR (v_evt.payload->>'to_stage_id')::uuid IS DISTINCT FROM v_stage_b THEN
    RAISE EXCEPTION 'CHECK FAILED: payload stages wrong: %', v_evt.payload;
  END IF;
  IF v_evt.payload->>'stage_tag' <> 'pse_review' THEN
    RAISE EXCEPTION 'CHECK FAILED: stage_tag is %, expected pse_review', v_evt.payload->>'stage_tag';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_rules
    WHERE event_type = 'project.stage_transition' AND is_active
      AND 'payload_users' = ANY (recipient_strategies)
      AND recipient_config->>'payload_field' = 'recipient_user_ids'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: no active notification_rule consumes project.stage_transition -- the event would be emitted and dropped';
  END IF;

  -- ── 2. Three actors, and the list IS the predicate ────────────────────
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_evt.payload->'recipient_user_ids')::uuid)
  INTO v_recips;

  IF NOT (v_powner = ANY (v_recips)) THEN
    RAISE EXCEPTION 'CHECK FAILED: the project OWNER was not notified';
  END IF;
  IF NOT (v_assigned = ANY (v_recips)) THEN
    RAISE EXCEPTION 'CHECK FAILED: a user ASSIGNED a task in the project was not notified';
  END IF;
  IF NOT (v_creator = ANY (v_recips)) THEN
    RAISE EXCEPTION 'CHECK FAILED: a project.view_all holder was not notified';
  END IF;
  IF v_zero = ANY (v_recips) THEN
    RAISE EXCEPTION 'CHECK FAILED: a user with NO access to the project was notified -- %', v_zero;
  END IF;

  -- The list is not merely right today: every actor's membership must equal
  -- fn_project_accessible() evaluated as that actor. If the recipient
  -- function ever stops routing through the predicate, this diverges.
  FOR v_n IN 1..4 LOOP
    DECLARE
      v_actor UUID := (ARRAY[v_powner, v_assigned, v_creator, v_zero])[v_n];
      v_acc   BOOLEAN;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);
      v_acc := public.fn_project_accessible(v_p_notify);
      IF v_acc <> (v_actor = ANY (v_recips)) THEN
        RAISE EXCEPTION 'CHECK FAILED: recipient list disagrees with fn_project_accessible for % (accessible=%, notified=%)',
          v_actor, v_acc, (v_actor = ANY (v_recips));
      END IF;
    END;
  END LOOP;

  -- ── 5. Claims restored ────────────────────────────────────────────────
  -- (asserted here, mid-run, because the damage would be to everything that
  -- follows a stage move inside the same transaction)
  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_creator::text, 'role', 'authenticated')::text, true);
  PERFORM public.fn_project_stage_notify_recipients(v_p_notify);
  IF auth.uid() IS DISTINCT FROM v_creator THEN
    RAISE EXCEPTION 'CHECK FAILED: fn_project_stage_notify_recipients leaked its impersonation -- auth.uid() is now %, expected %',
      auth.uid(), v_creator;
  END IF;

  -- ── 3./4. Automations ─────────────────────────────────────────────────
  -- From here on, run as the system (no auth.uid()), the way cron would.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- p_auto: overdue, in the automated source stage -> must move.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id, due_date)
  VALUES (v_company, 'PSE Automated Project', v_creator, v_powner, v_pipe, v_stage_a, NOW() - INTERVAL '3 days')
  RETURNING id INTO v_p_auto;

  -- p_future: same stage, NOT overdue -> must not move.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id, due_date)
  VALUES (v_company, 'PSE Future Project', v_creator, v_powner, v_pipe, v_stage_a, NOW() + INTERVAL '30 days')
  RETURNING id INTO v_p_future;

  -- p_still: overdue, but sitting in the siding stage, which no automation
  -- sources from.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id, due_date)
  VALUES (v_company, 'PSE Unautomated Project', v_creator, v_powner, v_pipe, v_stage_c, NOW() - INTERVAL '3 days')
  RETURNING id INTO v_p_still;

  INSERT INTO public.pipeline_automations
    (pipeline_id, source_stage_id, target_stage_id, condition_type, company_id)
  VALUES (v_pipe, v_stage_a, v_stage_b, 'overdue', v_company)
  RETURNING id INTO v_auto;

  -- The unchanged task branch, so the subject_kind split is proven not to
  -- have cost it: an overdue task in an automated TASK stage still advances.
  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'PSE Selfcheck Task Pipeline', 'task')
  RETURNING id INTO v_task_pipe;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_task_pipe, 'PSE T Open', 1, true) RETURNING id INTO v_ts_a;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal)
  VALUES (v_task_pipe, 'PSE T Done', 2, true) RETURNING id INTO v_ts_b;
  INSERT INTO public.pipeline_stage_transitions (from_stage_id, to_stage_id)
  VALUES (v_ts_a, v_ts_b);
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id, due_date)
  VALUES (v_company, 'PSE overdue task', v_creator, v_task_pipe, v_ts_a, NOW() - INTERVAL '3 days')
  RETURNING id INTO v_hot_task;
  INSERT INTO public.pipeline_automations
    (pipeline_id, source_stage_id, target_stage_id, condition_type, company_id)
  VALUES (v_task_pipe, v_ts_a, v_ts_b, 'overdue', v_company)
  RETURNING id INTO v_task_auto;

  -- Dedicated pipeline for the cadence checks (20260816), kept separate
  -- from v_pipe/v_stage_a so its rules never compete with v_auto over the
  -- same source stage.
  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'PSE Cadence Selfcheck Pipeline', 'project')
  RETURNING id INTO v_cadence_pipe;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_cadence_pipe, 'PSE Cadence A', 1, true) RETURNING id INTO v_cs_a;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal)
  VALUES (v_cadence_pipe, 'PSE Cadence B', 2, true) RETURNING id INTO v_cs_b;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_cadence_pipe, 'PSE Cadence C', 3) RETURNING id INTO v_cs_c;
  INSERT INTO public.pipeline_stage_transitions (from_stage_id, to_stage_id)
  VALUES (v_cs_a, v_cs_b), (v_cs_c, v_cs_b);

  -- check_interval_minutes: a rule that "just ran" must not re-fire on this
  -- tick even though its project is overdue.
  INSERT INTO public.pipeline_automations
    (pipeline_id, source_stage_id, target_stage_id, condition_type, check_interval_minutes, company_id)
  VALUES (v_cadence_pipe, v_cs_a, v_cs_b, 'overdue', 60, v_company)
  RETURNING id INTO v_auto_gated;
  UPDATE public.pipeline_automations SET last_run_at = NOW() WHERE id = v_auto_gated;

  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id, due_date)
  VALUES (v_company, 'PSE Gated Project', v_creator, v_powner, v_cadence_pipe, v_cs_a, NOW() - INTERVAL '3 days')
  RETURNING id INTO v_p_gated;

  -- buffer_minutes: overdue-by-less-than-buffer must not fire, overdue-by-
  -- more-than-buffer must.
  INSERT INTO public.pipeline_automations
    (pipeline_id, source_stage_id, target_stage_id, condition_type, company_id)
  VALUES (v_cadence_pipe, v_cs_c, v_cs_b, 'overdue', v_company)
  RETURNING id INTO v_auto_buffered;
  INSERT INTO public.pipeline_automation_params (automation_id, key, value)
  VALUES (v_auto_buffered, 'buffer_minutes', '60');

  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id, due_date)
  VALUES (v_company, 'PSE Buffer Not Elapsed', v_creator, v_powner, v_cadence_pipe, v_cs_c, NOW() - INTERVAL '10 minutes')
  RETURNING id INTO v_p_buf_no;
  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id, due_date)
  VALUES (v_company, 'PSE Buffer Elapsed', v_creator, v_powner, v_cadence_pipe, v_cs_c, NOW() - INTERVAL '90 minutes')
  RETURNING id INTO v_p_buf_yes;

  PERFORM public.rpc_process_automations();

  IF (SELECT current_stage_id FROM public.projects WHERE id = v_p_auto) IS DISTINCT FROM v_stage_b THEN
    RAISE EXCEPTION 'CHECK FAILED: an overdue project in an automated stage did NOT advance';
  END IF;
  IF (SELECT current_stage_id FROM public.projects WHERE id = v_p_still) IS DISTINCT FROM v_stage_c THEN
    RAISE EXCEPTION 'CHECK FAILED: a project in a stage with NO automation was moved';
  END IF;
  IF (SELECT current_stage_id FROM public.projects WHERE id = v_p_future) IS DISTINCT FROM v_stage_a THEN
    RAISE EXCEPTION 'CHECK FAILED: a project that is not overdue was moved by an overdue automation';
  END IF;
  IF (SELECT current_stage_id FROM public.tasks WHERE id = v_hot_task) IS DISTINCT FROM v_ts_b THEN
    RAISE EXCEPTION 'CHECK FAILED: the unchanged TASK automation branch stopped advancing overdue tasks';
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.automation_execution_log
  WHERE project_id = v_p_auto AND automation_id = v_auto;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: automation_execution_log has % rows for the moved project, expected 1 (the 3-per-hour circuit breaker is blind)', v_n;
  END IF;

  -- The automated move must notify too -- an automation that moves a project
  -- silently is the exact thing §20 says a stage change must stop being.
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.stage_transition' AND entity_id = v_p_auto;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: the automated move emitted % events, expected 1', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_events
    WHERE event_type = 'project.stage_transition' AND entity_id IN (v_p_still, v_p_future)
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: an event was emitted for a project that never moved';
  END IF;

  -- 20260816: check_interval_minutes actually gates.
  IF (SELECT current_stage_id FROM public.projects WHERE id = v_p_gated) IS DISTINCT FROM v_cs_a THEN
    RAISE EXCEPTION 'CHECK FAILED: a rule with last_run_at inside its check_interval_minutes re-fired anyway';
  END IF;

  -- 20260816: buffer_minutes actually gates.
  IF (SELECT current_stage_id FROM public.projects WHERE id = v_p_buf_no) IS DISTINCT FROM v_cs_c THEN
    RAISE EXCEPTION 'CHECK FAILED: a project overdue by less than buffer_minutes fired anyway';
  END IF;
  IF (SELECT current_stage_id FROM public.projects WHERE id = v_p_buf_yes) IS DISTINCT FROM v_cs_b THEN
    RAISE EXCEPTION 'CHECK FAILED: a project overdue by more than buffer_minutes did not fire';
  END IF;

  -- 20260816: last_run_at gets stamped so the interval gate has something to
  -- compare against on the next tick, for every rule actually evaluated.
  IF (SELECT last_run_at FROM public.pipeline_automations WHERE id = v_auto_buffered) IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_process_automations() did not stamp last_run_at';
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED: project stage changes notify (owner / assignee / view_all, never a no-access user), overdue projects automate, and check_interval_minutes/buffer_minutes gate correctly.';
END $$;

ROLLBACK;
