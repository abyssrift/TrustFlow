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
