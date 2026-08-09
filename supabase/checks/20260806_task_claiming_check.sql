-- Issue #25 check: rpc_set_team_claiming and rpc_claim_task.
--
-- Not a migration -- run by hand against a DEV/STAGING database only:
--   psql "$DATABASE_URL" -f supabase/checks/20260806_task_claiming_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: reuses an existing seeded non-owner user (same
-- pattern as check_projects_update_accessible.sql) but creates its own
-- throwaway team/pipeline/task inside that user's company. Always rolls
-- back -- safe to re-run, never leaves rows behind.
--
-- NOTE: this does not exercise rpc_start_work's claim gate -- task_participants
-- (the table rpc_start_work checks before allowing a session) predates this
-- repo's tracked migrations and its population mechanics aren't reproducible
-- here with confidence. Verify that gate manually in the running app instead:
-- a non-claimant on a claiming-enabled task should get "This task must be
-- claimed before starting work" / "...claimed by another team member" when
-- attempting to start a timer.

BEGIN;

DO $$
DECLARE
  v_co          UUID;
  v_claimant    UUID;   -- same-company user, will be granted team.edit + made a team member
  v_bystander   UUID;   -- a second same-company user, NOT on the team
  v_team        UUID;
  v_pipe        UUID;
  v_stage       UUID;
  v_task        UUID;
  v_role        UUID;
  v_claimed_by  UUID;
  v_rejected    BOOLEAN := false;
BEGIN
  SELECT company_id, id INTO v_co, v_claimant
  FROM public.users WHERE is_owner = false AND company_id IS NOT NULL LIMIT 1;

  IF v_co IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: no non-owner seeded user found to impersonate';
  END IF;

  SELECT id INTO v_bystander FROM public.users WHERE company_id = v_co AND id <> v_claimant LIMIT 1;
  IF v_bystander IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need a second same-company user to test rejection of a non-team-member';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = v_claimant;

  INSERT INTO public.teams (company_id, name) VALUES (v_co, 'ZZ Claiming Team') RETURNING id INTO v_team;
  INSERT INTO public.team_members (team_id, user_id, company_id) VALUES (v_team, v_claimant, v_co);

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_co, 'Claiming Check Pipeline', 'task') RETURNING id INTO v_pipe;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipe, 'Open', 0, true) RETURNING id INTO v_stage;

  INSERT INTO public.tasks (company_id, title, pipeline_id, current_stage_id, created_by, manager_id)
  VALUES (v_co, 'Claiming Check Task', v_pipe, v_stage, v_claimant, v_claimant) RETURNING id INTO v_task;

  -- Assert 1: claiming a task with enforcement OFF is rejected.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_claimant::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.rpc_claim_task(v_task);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: claiming succeeded even though the team has claiming disabled';
  END IF;

  -- Assert 2: rpc_set_team_claiming is rejected for a user without
  -- team.edit and not owner.
  v_rejected := false;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_claimant::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.rpc_set_team_claiming(v_team, true);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_set_team_claiming succeeded without team.edit';
  END IF;

  -- Grant team.edit, turn claiming on, assign the team to the task.
  INSERT INTO public.roles (company_id, name) VALUES (v_co, 'ZZ Team Editor') RETURNING id INTO v_role;
  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role, id FROM public.permissions WHERE key = 'team.edit';
  INSERT INTO public.user_roles (user_id, role_id, company_id) VALUES (v_claimant, v_role, v_co);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_claimant::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.rpc_set_team_claiming(v_team, true);
  RESET ROLE;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_team_id, assigned_by) VALUES (v_task, v_co, v_team, v_claimant);

  -- Assert 3: a bystander (not on the team) cannot claim.
  v_rejected := false;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bystander::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.rpc_claim_task(v_task);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: a user not on the assigned team was able to claim the task';
  END IF;

  -- Assert 4: a team member can claim, and re-claiming by the same user is a no-op success.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_claimant::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.rpc_claim_task(v_task);
  PERFORM public.rpc_claim_task(v_task);
  RESET ROLE;

  SELECT claimed_by INTO v_claimed_by FROM public.tasks WHERE id = v_task;
  IF v_claimed_by IS DISTINCT FROM v_claimant THEN
    RAISE EXCEPTION 'CHECK FAILED: task.claimed_by is % (expected %)', v_claimed_by, v_claimant;
  END IF;

  -- Assert 5: the bystander cannot claim a task already claimed by someone else.
  v_rejected := false;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bystander::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.rpc_claim_task(v_task);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  RESET ROLE;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'CHECK FAILED: a second user was able to claim an already-claimed task';
  END IF;

  -- Assert 6: advancing the stage auto-releases the claim.
  DECLARE
    v_stage2 UUID;
  BEGIN
    INSERT INTO public.pipeline_stages (pipeline_id, name, position) VALUES (v_pipe, 'Next', 1) RETURNING id INTO v_stage2;
    PERFORM public.rpc_advance_stage(v_task, v_stage2);

    SELECT claimed_by INTO v_claimed_by FROM public.tasks WHERE id = v_task;
    IF v_claimed_by IS NOT NULL THEN
      RAISE EXCEPTION 'CHECK FAILED: claim was not released on stage change (still claimed by %)', v_claimed_by;
    END IF;
  END;

  -- Review fix (PR #206): rpc_update_task_assignments used to clear a
  -- claim on ANY assignment edit, because the DELETE-then-reinsert it does
  -- as one call fired a per-row DELETE trigger before the reinsert could
  -- show whether the claimant was still eligible. Re-claim (the stage
  -- change above released it) and prove the RPC itself is now claim-aware.

  -- Assert 7: re-claim, then ADD an assignee (bystander) alongside the
  -- still-assigned team -- the claimant's own path (team membership) is
  -- untouched by the edit, so the claim must survive.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_claimant::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.rpc_claim_task(v_task);
  PERFORM public.rpc_update_task_assignments(v_task, ARRAY[v_bystander], ARRAY[v_team]);
  RESET ROLE;

  SELECT claimed_by INTO v_claimed_by FROM public.tasks WHERE id = v_task;
  IF v_claimed_by IS DISTINCT FROM v_claimant THEN
    RAISE EXCEPTION 'CHECK FAILED: adding an assignee via rpc_update_task_assignments cleared an existing claim (claimed_by is %, expected %)', v_claimed_by, v_claimant;
  END IF;

  -- Assert 8: now remove the claimant's actual assignment path (drop the
  -- team from the assignment set, keep only the bystander) -- the claim
  -- must be cleared, since the claimant is no longer eligible.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_claimant::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.rpc_update_task_assignments(v_task, ARRAY[v_bystander], '{}'::uuid[]);
  RESET ROLE;

  SELECT claimed_by INTO v_claimed_by FROM public.tasks WHERE id = v_task;
  IF v_claimed_by IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: removing the claimants assignment via rpc_update_task_assignments left claimed_by = % (expected NULL)', v_claimed_by;
  END IF;

  RAISE NOTICE 'OK: rpc_set_team_claiming is permission-gated, rpc_claim_task restricts claiming to team members and is exclusive/idempotent, the claim auto-releases on stage change, and rpc_update_task_assignments preserves a claim when adding an assignee but clears it when the claimants own assignment is removed';
END $$;

ROLLBACK;
