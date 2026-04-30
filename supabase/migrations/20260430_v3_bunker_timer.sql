-- ====================================================================
-- Bunker-Grade Unified Timer System: ULTRA-HARDENED MIGRATION (V3)
-- ====================================================================

-- 1. Table Schema with Invariant Constraints
CREATE TABLE IF NOT EXISTS public.task_work_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed')) DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- [INVARIANT] Duration cannot be negative
    CONSTRAINT duration_non_negative CHECK (last_heartbeat_at >= started_at)
);

-- 2. Security (Default Deny for mutations)
ALTER TABLE public.task_work_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own work sessions" ON public.task_work_sessions;
CREATE POLICY "Users can view their own work sessions"
    ON public.task_work_sessions FOR SELECT
    USING (auth.uid() = user_id);

-- 3. RPC: rpc_start_work
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
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    -- [TIME GUARD] Clamp start time to 5m drift
    IF v_final_start_time > now() + interval '1 minute' OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    UPDATE public.task_work_sessions
    SET status = 'completed', last_heartbeat_at = now()
    WHERE user_id = auth.uid() AND status = 'active';

    INSERT INTO public.task_work_sessions (task_id, started_at, status)
    VALUES (p_task_id, v_final_start_time, 'active')
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

-- 4. RPC: rpc_heartbeat_work
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
    -- [CONCURRENCY] Ensure serialized updates
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    SELECT task_id INTO v_task_id FROM public.task_work_sessions 
    WHERE id = p_session_id AND user_id = auth.uid();

    IF v_task_id IS NULL THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    -- Participation Check (Revocation Logic)
    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = v_task_id AND user_id = auth.uid()
    ) THEN
        UPDATE public.task_work_sessions SET status = 'completed' WHERE id = p_session_id;
        RAISE EXCEPTION 'Membership revoked.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.task_work_sessions
    SET last_heartbeat_at = now()
    WHERE id = p_session_id AND user_id = auth.uid() AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session already completed' USING ERRCODE = '23505';
    END IF;
END;
$$;

-- 5. RPC: rpc_stop_work
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
    v_final_stop_time TIMESTAMPTZ := p_stopped_at;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    -- [GUARDRAIL] Cap stop time to now() to prevent future-dating
    IF v_final_stop_time > now() + interval '1 minute' THEN
        v_final_stop_time := now();
    END IF;

    -- Try to update existing session (No participation check here to allow completing valid work)
    UPDATE public.task_work_sessions
    SET status = 'completed', last_heartbeat_at = v_final_stop_time
    WHERE id = p_session_id AND user_id = auth.uid();

    IF NOT FOUND THEN
        -- [RECOVERY PATH] Requires participation check
        IF NOT EXISTS (
            SELECT 1 FROM public.task_participants
            WHERE task_id = p_task_id AND user_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'Membership revoked.' USING ERRCODE = '42501';
        END IF;

        -- [GUARDRAIL] Apply backdating limit and duration invariant
        IF v_final_start_time IS NULL OR v_final_start_time < v_final_stop_time - interval '5 minutes' THEN
            v_final_start_time := v_final_stop_time - interval '1 second';
        END IF;
        
        -- Final invariant check
        IF v_final_start_time > v_final_stop_time THEN
            v_final_start_time := v_final_stop_time - interval '1 second';
        END IF;

        INSERT INTO public.task_work_sessions (id, user_id, task_id, started_at, last_heartbeat_at, status)
        VALUES (p_session_id, auth.uid(), p_task_id, v_final_start_time, v_final_stop_time, 'completed');
    END IF;
END;
$$;
