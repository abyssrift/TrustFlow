-- Safety net for the "recorded time discarded" bug class: any path that
-- flips a session active -> completed without computing total_seconds_spent
-- gets a duration backfilled at the row level, so no closer can forget again.
-- Does NOT fire when total_seconds_spent > 0 (rpc_stop_work / manual-time
-- approvals write business-hours durations that must not be clobbered).

CREATE OR REPLACE FUNCTION public.fn_backfill_session_duration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.total_seconds_spent := GREATEST(
        1,
        EXTRACT(EPOCH FROM (
            COALESCE(NEW.completed_at, NEW.last_heartbeat_at, now()) - NEW.started_at
        ))::int
    );
    IF NEW.completed_at IS NULL THEN
        NEW.completed_at := COALESCE(NEW.last_heartbeat_at, now());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backfill_session_duration ON public.task_work_sessions;
CREATE TRIGGER trg_backfill_session_duration
BEFORE UPDATE ON public.task_work_sessions
FOR EACH ROW
WHEN (OLD.status = 'active' AND NEW.status = 'completed'
      AND COALESCE(NEW.total_seconds_spent, 0) <= 0)
EXECUTE FUNCTION public.fn_backfill_session_duration();

-- rpc_start_work: orphan-cleanup now anchors duration to last_heartbeat_at
-- (last proof of life) instead of now(), and no longer overwrites
-- last_heartbeat_at. Everything else identical to previous definition.

CREATE OR REPLACE FUNCTION public.rpc_start_work(
    p_task_id UUID,
    p_start_time TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = p_task_id;

    IF v_final_start_time > now() + interval '1 minute'
       OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    -- [ORPHAN CLEANUP] Close any session this user left dangling 'active'
    -- (stale tab, duplicate start, crash). Anchor to last_heartbeat_at:
    -- now() over-counts sessions abandoned hours ago, and last_heartbeat_at
    -- is the last proof of life so we keep it untouched.
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
$$;
