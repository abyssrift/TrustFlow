-- Issue #25: Task claiming toggle in team settings (single-claimant assignment).
--
-- A per-team setting (teams.enforce_single_claimant) that, when on, requires
-- one of the members already assigned to a task (via that team) to "claim"
-- it before starting a work session -- and blocks everyone else from
-- starting one while it's claimed. Enforcement point is starting a
-- timer/work session (rpc_start_work), not stage advancement or submission.
--
-- Repurposes the existing dead 'Claim Task' button/rpc_claim_task call in
-- TaskCardActions.tsx (was calling a function that never existed in any
-- migration -- confirmed dead, never visible in the running app since its
-- old trigger condition (zero assignees) never fires from real usage). Old
-- meaning (self-assign to an unclaimed, unassigned task) is removed
-- entirely and replaced with this issue's meaning (claim among assigned
-- members to become the sole active worker).

-- ============================================================
-- Section 1: teams.enforce_single_claimant
-- ============================================================
ALTER TABLE public.teams ADD COLUMN enforce_single_claimant BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- Section 2: tasks claim state
-- ============================================================
ALTER TABLE public.tasks ADD COLUMN claimed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN claimed_at TIMESTAMPTZ;

-- ============================================================
-- Section 3: rpc_set_team_claiming -- toggle, gated by team.edit
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_set_team_claiming(p_team_id uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
BEGIN
  SELECT company_id INTO v_company_id FROM public.teams WHERE id = p_team_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Team not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('team.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE public.teams SET enforce_single_claimant = p_enabled WHERE id = p_team_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_set_team_claiming(uuid, boolean) TO authenticated;

-- ============================================================
-- Section 4: rpc_claim_task -- real implementation (was dead)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_claim_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_claimed_by UUID;
  v_eligible   BOOLEAN;
BEGIN
  SELECT company_id, claimed_by INTO v_company_id, v_claimed_by
  FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.task_assignments ta
    JOIN public.teams t ON t.id = ta.assignee_team_id
    WHERE ta.task_id = p_task_id AND t.enforce_single_claimant = TRUE
  ) THEN
    RAISE EXCEPTION 'Task claiming is not enabled for this task';
  END IF;

  -- Eligible = assigned to this task directly, or a member of a team
  -- assigned to this task that has claiming enabled.
  v_eligible := EXISTS (
    SELECT 1 FROM public.task_assignments ta WHERE ta.task_id = p_task_id AND ta.assignee_user_id = v_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.task_assignments ta
    JOIN public.teams t ON t.id = ta.assignee_team_id
    JOIN public.team_members tm ON tm.team_id = t.id
    WHERE ta.task_id = p_task_id AND t.enforce_single_claimant = TRUE
      AND tm.user_id = v_user_id AND tm.removed_at IS NULL
  );

  IF NOT v_eligible THEN
    RAISE EXCEPTION 'Only a member already assigned to this task can claim it';
  END IF;

  IF v_claimed_by IS NOT NULL AND v_claimed_by != v_user_id THEN
    RAISE EXCEPTION 'Task is already claimed by another team member';
  END IF;

  UPDATE public.tasks SET claimed_by = v_user_id, claimed_at = now() WHERE id = p_task_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_claim_task(uuid) TO authenticated;

-- ============================================================
-- Section 5: auto-release -- claim clears when the task leaves its
-- current stage, or when the claimant is unassigned from the task.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_trg_tasks_clear_claim_on_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id AND NEW.claimed_by IS NOT NULL THEN
    NEW.claimed_by := NULL;
    NEW.claimed_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_tasks_clear_claim_on_stage_change
  BEFORE UPDATE OF current_stage_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_tasks_clear_claim_on_stage_change();

CREATE OR REPLACE FUNCTION public.fn_trg_task_assignments_clear_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.assignee_user_id IS NOT NULL THEN
    UPDATE public.tasks SET claimed_by = NULL, claimed_at = NULL
    WHERE id = OLD.task_id AND claimed_by = OLD.assignee_user_id;
  ELSIF OLD.assignee_team_id IS NOT NULL THEN
    -- ponytail: clears the claim only when the whole team assignment is
    -- removed, not when an individual leaves team_members while the team
    -- stays assigned. Add a team_members DELETE trigger if that gap matters.
    UPDATE public.tasks t SET claimed_by = NULL, claimed_at = NULL
    WHERE t.id = OLD.task_id AND t.claimed_by IN (
      SELECT user_id FROM public.team_members WHERE team_id = OLD.assignee_team_id AND removed_at IS NULL
    );
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER trg_task_assignments_clear_claim
  AFTER DELETE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_task_assignments_clear_claim();

-- ============================================================
-- Section 6: rpc_start_work -- gate starting a session on the claim.
-- Full redefinition (body copied from 20260729_orphan_session_delete_under_15s.sql)
-- plus the claim check, matching this repo's per-migration full-redefine convention.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_start_work(p_task_id uuid, p_start_time timestamp with time zone)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session_id        UUID;
    v_company_id        UUID;
    v_stage_id          UUID;
    v_claimed_by        UUID;
    v_final_start_time  TIMESTAMPTZ := p_start_time;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    -- #160: the per-user advisory lock above does not serialise against an
    -- archive of this task. Take the task row so we either start before the
    -- archive's guard sees us, or wait and find the task gone.
    SELECT company_id, current_stage_id, claimed_by
    INTO v_company_id, v_stage_id, v_claimed_by
    FROM public.tasks WHERE id = p_task_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This task was archived or deleted. Refresh to see the current board.'
            USING ERRCODE = 'P0002';
    END IF;

    -- #25: single-claimant enforcement. Only checked when the task is
    -- assigned to a team that has claiming turned on.
    IF EXISTS (
        SELECT 1 FROM public.task_assignments ta
        JOIN public.teams t ON t.id = ta.assignee_team_id
        WHERE ta.task_id = p_task_id AND t.enforce_single_claimant = TRUE
    ) THEN
        IF v_claimed_by IS NULL THEN
            RAISE EXCEPTION 'This task must be claimed before starting work' USING ERRCODE = 'P0001';
        ELSIF v_claimed_by != auth.uid() THEN
            RAISE EXCEPTION 'This task is claimed by another team member' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF v_final_start_time > now() + interval '1 minute'
       OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    -- [ORPHAN CLEANUP] Close any session this user left dangling 'active'
    -- (stale tab, duplicate start, crash). Anchor to last_heartbeat_at:
    -- now() over-counts sessions abandoned hours ago, and last_heartbeat_at
    -- is the last proof of life so we keep it untouched.
    --
    -- A session orphaned before its first heartbeat has last_heartbeat_at ==
    -- started_at, which would floor to a misleading 1s row below -- delete
    -- it instead, matching the client's own 15s persistence floor.
    DELETE FROM public.task_work_sessions
    WHERE user_id = auth.uid() AND status = 'active'
      AND EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)) < 15;

    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = last_heartbeat_at,
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (last_heartbeat_at - started_at))::int)
    WHERE user_id = auth.uid() AND status = 'active';

    INSERT INTO public.task_work_sessions (
        task_id, user_id, company_id, stage_id, started_at, status
    )
    VALUES (
        p_task_id, auth.uid(), v_company_id, v_stage_id, v_final_start_time, 'active'
    )
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$function$;

-- ============================================================
-- Section 7: review fix (PR #206, found by a reviewer other than the
-- original author) -- rpc_update_task_assignments is the sole writer to
-- task_assignments (search migrations for it; its current live body is
-- reproduced below verbatim from the DB, since no committed migration
-- actually holds it -- it predates this repo's tracked migration history).
-- It does a blanket DELETE FROM task_assignments followed by a fresh
-- INSERT of the whole new assignee/team set, as ONE call. That DELETE used
-- to fire trg_task_assignments_clear_claim (Section 5, dropped below) once
-- per deleted row, mid-transaction, before the reinsert -- so editing a
-- claimed task's assignees for ANY reason (even adding one more member, or
-- re-saving the identical set) cleared the claim, because the trigger had
-- no way to "wait and see" the final state.
--
-- Fix: make the RPC itself claim-aware at the one place all assignment
-- edits funnel through. After the new set is fully in place, re-check the
-- claimant's eligibility with the SAME rule rpc_claim_task uses (directly
-- assigned, or a member of an enforcing team currently assigned to the
-- task). Only clear the claim if that re-check fails. tasks has a
-- BEFORE UPDATE trigger (set_updated_at) that already stamps updated_at
-- on this UPDATE, so nothing extra is needed for that.
--
-- ponytail: the documented gap in fn_trg_task_assignments_clear_claim (a
-- claimant leaving team_members while the team assignment stays on the
-- task doesn't release the claim) is untouched -- still an intentionally
-- deferred limitation, not in scope here.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_update_task_assignments(p_task_id uuid, p_user_ids uuid[] DEFAULT '{}'::uuid[], p_team_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_manager_id UUID;
  v_uid        UUID;
  v_tid        UUID;
  v_claimed_by UUID;
BEGIN
  -- 1: Check Permissions
  SELECT company_id, manager_id INTO v_company_id, v_manager_id FROM public.tasks WHERE id = p_task_id;

  -- Must be task manager OR company owner
  IF v_user_id != v_manager_id AND NOT (SELECT is_owner FROM public.users WHERE id = v_user_id) THEN
    -- Or if they are a manager of one of target teams?
    -- For now, keep it simple: Task Manager only.
    RAISE EXCEPTION 'Only the task manager can modify assignments.';
  END IF;

  -- 2: Clear old assignments
  DELETE FROM public.task_assignments WHERE task_id = p_task_id;

  -- 3: Insert User Assignments
  FOREACH v_uid IN ARRAY p_user_ids LOOP
    INSERT INTO public.task_assignments(task_id, company_id, assignee_user_id, assigned_by)
    VALUES (p_task_id, v_company_id, v_uid, v_user_id);
  END LOOP;

  -- 4: Insert Team Assignments
  FOREACH v_tid IN ARRAY p_team_ids LOOP
    INSERT INTO public.task_assignments(task_id, company_id, assignee_team_id, assigned_by)
    VALUES (p_task_id, v_company_id, v_tid, v_user_id);
  END LOOP;

  PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.assignments_updated', jsonb_build_object('user_count', array_length(p_user_ids, 1), 'team_count', array_length(p_team_ids, 1)));

  -- 5: #25 review fix -- re-check the claim against the now-final
  -- assignment set (same eligibility rule as rpc_claim_task).
  SELECT claimed_by INTO v_claimed_by FROM public.tasks WHERE id = p_task_id;
  IF v_claimed_by IS NOT NULL AND NOT (
    EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = p_task_id AND ta.assignee_user_id = v_claimed_by
    ) OR EXISTS (
      SELECT 1 FROM public.task_assignments ta
      JOIN public.teams t ON t.id = ta.assignee_team_id
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE ta.task_id = p_task_id AND t.enforce_single_claimant = TRUE
        AND tm.user_id = v_claimed_by AND tm.removed_at IS NULL
    )
  ) THEN
    UPDATE public.tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = p_task_id;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_update_task_assignments(uuid, uuid[], uuid[]) TO authenticated;

-- ============================================================
-- Section 8: drop the superseded per-row DELETE trigger from Section 5.
-- rpc_update_task_assignments (Section 7) now handles the claim re-check
-- at the one place all assignment edits funnel through, so the trigger's
-- out-of-order "clear on every deleted row" behavior is no longer needed
-- and was the actual bug. The OTHER Section 5 trigger
-- (trg_tasks_clear_claim_on_stage_change, on tasks) is unrelated and
-- unaffected -- it stays.
-- ============================================================
DROP TRIGGER IF EXISTS trg_task_assignments_clear_claim ON public.task_assignments;
DROP FUNCTION IF EXISTS public.fn_trg_task_assignments_clear_claim();
