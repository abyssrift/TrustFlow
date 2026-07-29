-- Orphan-closed timer sessions were floored to a misleading 1s duration
-- instead of being discarded, polluting "Recent Sessions" with junk rows.
--
-- rpc_start_work's orphan cleanup force-closes any session a user left
-- dangling 'active' when they start a new one, anchoring the duration to
-- last_heartbeat_at (last proof of life) instead of now() -- intentionally,
-- so a session abandoned for hours isn't over-counted. But last_heartbeat_at
-- defaults to now() at row creation and only advances once the heartbeat
-- pulse fires (every 30s -- hooks/useSmartTimer.ts). A session orphan-closed
-- before its first heartbeat therefore has last_heartbeat_at == started_at,
-- so the computed duration is ~0 and GREATEST(1, ...) floors it to exactly
-- 1 second -- discarding whatever real (if brief) time was spent, rather
-- than reporting it.
--
-- The client already refuses to persist a session shorter than 15s (see the
-- commit debounce in contexts/TimerContext.tsx). Apply the same floor here:
-- below 15s the row is deleted instead of kept as a misleading artifact.

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
    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = p_task_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This task was archived or deleted. Refresh to see the current board.'
            USING ERRCODE = 'P0002';
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

-- One-time cleanup of existing sub-15s artifacts created by the bug above.
-- task_manual_time_entries.session_id is ON DELETE SET NULL, so this cannot
-- orphan a manual-time approval record.
DELETE FROM public.task_work_sessions
WHERE status = 'completed' AND total_seconds_spent < 15;
