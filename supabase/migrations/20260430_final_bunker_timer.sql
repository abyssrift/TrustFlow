-- ====================================================================
-- Bunker-Grade Unified Timer System: FINAL HARDENED MIGRATION
-- ====================================================================

-- 1. Table Consistency (Ensure table exists)
CREATE TABLE IF NOT EXISTS public.task_work_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed')) DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Security: TOTAL API LOCKDOWN (RLS)
-- Only SELECT is allowed for the public role. 
-- ALL mutations (Insert/Update/Delete) must go through validated SECURITY DEFINER RPCs.
ALTER TABLE public.task_work_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own work sessions" ON public.task_work_sessions;
DROP POLICY IF EXISTS "Users can create their own work sessions" ON public.task_work_sessions;
DROP POLICY IF EXISTS "Users can update their own work sessions" ON public.task_work_sessions;

-- 2.1. SELECT: Users can only view their own records.
CREATE POLICY "Users can view their own work sessions"
    ON public.task_work_sessions FOR SELECT
    USING (auth.uid() = user_id);

-- (Default Deny for INSERT/UPDATE/DELETE ensures no direct API tampering)

-- 3. RPC: rpc_start_work (Ultra-Hardened)
CREATE OR REPLACE FUNCTION public.rpc_start_work(
    p_task_id UUID,
    p_start_time TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_session_id UUID;
    v_final_start_time TIMESTAMPTZ := p_start_time;
BEGIN
    -- [CONCURRENCY] Per-user advisory lock to prevent simultaneous session starts
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    -- Validate participation
    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant in this task' USING ERRCODE = '42501';
    END IF;

    -- [TIME GUARD] Prevent extreme backdating/future-dating (5m drift)
    IF v_final_start_time > now() + interval '1 minute' OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    -- [SINGLETON] Clean up ALL active sessions for this user globally
    UPDATE public.task_work_sessions
    SET status = 'completed',
        last_heartbeat_at = now()
    WHERE user_id = auth.uid()
      AND status = 'active';

    -- [ATOMIC INSERT] Now safe due to table lockdown and advisory lock
    INSERT INTO public.task_work_sessions (task_id, started_at, status)
    VALUES (p_task_id, v_final_start_time, 'active')
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

-- 4. RPC: rpc_heartbeat_work (Ultra-Hardened)
CREATE OR REPLACE FUNCTION public.rpc_heartbeat_work(
    p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_task_id UUID;
BEGIN
    -- [DISCOVERY] Check existence before participation to ensure accurate errors
    SELECT task_id INTO v_task_id 
    FROM public.task_work_sessions 
    WHERE id = p_session_id AND user_id = auth.uid();

    IF v_task_id IS NULL THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    -- [SECURITY] Mandatory Participation Check
    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = v_task_id AND user_id = auth.uid()
    ) THEN
        -- Force stop the session if membership was revoked
        UPDATE public.task_work_sessions SET status = 'completed' WHERE id = p_session_id;
        RAISE EXCEPTION 'Membership revoked. Session terminated.' USING ERRCODE = '42501';
    END IF;

    -- [UPDATE] Only succeeds if status is still 'active'
    UPDATE public.task_work_sessions
    SET last_heartbeat_at = now()
    WHERE id = p_session_id
      AND user_id = auth.uid()
      AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session already completed' USING ERRCODE = '23505';
    END IF;
END;
$$;

-- 5. RPC: rpc_stop_work (Ultra-Hardened)
CREATE OR REPLACE FUNCTION public.rpc_stop_work(
    p_session_id UUID,
    p_task_id UUID,
    p_stopped_at TIMESTAMPTZ,
    p_started_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_final_start_time TIMESTAMPTZ := p_started_at;
BEGIN
    -- Mandatory Participation Check
    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Membership revoked.' USING ERRCODE = '42501';
    END IF;

    -- Try to update existing session
    UPDATE public.task_work_sessions
    SET status = 'completed',
        last_heartbeat_at = p_stopped_at
    WHERE id = p_session_id
      AND user_id = auth.uid();

    -- [RECOVERY] Create-on-demand if not found
    IF NOT FOUND THEN
        -- [GUARDRAIL] Apply the same 5m backdating limit to recovered sessions
        IF v_final_start_time IS NULL OR v_final_start_time < p_stopped_at - interval '5 minutes' THEN
            v_final_start_time := p_stopped_at - interval '1 second';
        END IF;

        INSERT INTO public.task_work_sessions (id, user_id, task_id, started_at, last_heartbeat_at, status)
        VALUES (p_session_id, auth.uid(), p_task_id, v_final_start_time, p_stopped_at, 'completed');
    END IF;
END;
$$;
