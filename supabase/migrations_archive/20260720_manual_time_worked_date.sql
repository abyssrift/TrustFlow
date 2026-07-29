-- ============================================================
-- Fix (#71): editing/declaring time for a previously finished
-- stage always attributed the resulting work session to "today"
-- (rpc_review_manual_time anchored the session on `logged_at`,
-- i.e. whenever the declaration was submitted/approved, not when
-- the work actually happened).
--
-- Adds `worked_date` so the declarant can say which day the work
-- happened; approval now backdates the session onto that date
-- instead of the submission/approval date.
-- ============================================================

ALTER TABLE public.task_manual_time_entries
    ADD COLUMN IF NOT EXISTS worked_date DATE;

UPDATE public.task_manual_time_entries
SET worked_date = logged_at::date
WHERE worked_date IS NULL;

ALTER TABLE public.task_manual_time_entries
    ALTER COLUMN worked_date SET NOT NULL,
    ALTER COLUMN worked_date SET DEFAULT CURRENT_DATE;

-- ── rpc_log_manual_time: accept p_worked_date ─────────────────
DROP FUNCTION IF EXISTS public.rpc_log_manual_time(uuid, uuid, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.rpc_log_manual_time(
    p_task_id          UUID,
    p_stage_id         UUID,
    p_declared_minutes INTEGER,
    p_reason           TEXT DEFAULT NULL,
    p_transition_id    UUID DEFAULT NULL,
    p_worked_date      DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id               UUID    := auth.uid();
    v_task                  RECORD;
    v_company_id            UUID;
    v_is_owner              BOOLEAN;
    v_is_manager            BOOLEAN;
    v_is_assigned           BOOLEAN;
    v_existing_status       TEXT;
    v_is_flagged            BOOLEAN := false;
    v_flag_reason           TEXT    := NULL;
    v_estimated_minutes     NUMERIC;
    v_stage_p95_minutes     NUMERIC;
    v_minutes_since_created NUMERIC;
    v_worked_date           DATE    := COALESCE(p_worked_date, CURRENT_DATE);
BEGIN
    IF p_declared_minutes IS NULL OR p_declared_minutes <= 0 THEN
        RAISE EXCEPTION 'Declared time must be greater than 0 minutes' USING ERRCODE = 'P0001';
    END IF;
    IF p_declared_minutes > 1440 THEN
        RAISE EXCEPTION 'Declared time cannot exceed 24 hours (1440 minutes)' USING ERRCODE = 'P0001';
    END IF;
    IF v_worked_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'Work date cannot be in the future' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
    END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    v_is_owner   := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
    v_is_manager := v_task.manager_id = v_user_id;
    v_is_assigned := EXISTS (
        SELECT 1 FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members
                WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
    );

    IF NOT (v_is_assigned OR v_is_manager OR v_is_owner) THEN
        RAISE EXCEPTION 'You are not assigned to this task' USING ERRCODE = '42501';
    END IF;

    -- Race guard: if a pending entry already exists, do not let the same user
    -- overwrite it with a different transition while the manager is reviewing.
    SELECT approval_status INTO v_existing_status
    FROM public.task_manual_time_entries
    WHERE task_id = p_task_id AND stage_id = p_stage_id AND user_id = v_user_id;

    IF v_existing_status = 'pending' THEN
        RAISE EXCEPTION 'A time declaration is already awaiting manager approval for this stage.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Fraud check 1: task estimated_hours
    IF v_task.estimated_hours IS NOT NULL THEN
        v_estimated_minutes := v_task.estimated_hours * 60;
        IF p_declared_minutes > v_estimated_minutes THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds task estimate (%s min)',
                p_declared_minutes, v_estimated_minutes::integer
            );
        END IF;
    END IF;

    -- Fraud check 2: stage P95
    IF NOT v_is_flagged THEN
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.total_seconds_spent) / 60.0
        INTO v_stage_p95_minutes
        FROM public.task_work_sessions s
        WHERE s.stage_id          = p_stage_id
          AND s.status            = 'completed'
          AND s.total_seconds_spent IS NOT NULL
          AND s.total_seconds_spent > 60;

        IF v_stage_p95_minutes IS NOT NULL AND p_declared_minutes > (v_stage_p95_minutes * 2) THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds 2x stage P95 average (%s min)',
                p_declared_minutes, v_stage_p95_minutes::integer
            );
        END IF;
    END IF;

    -- Fraud check 3: temporal plausibility
    v_minutes_since_created := EXTRACT(EPOCH FROM (now() - v_task.created_at)) / 60.0;
    IF p_declared_minutes > v_minutes_since_created THEN
        v_is_flagged  := true;
        v_flag_reason := format(
            'Declared time (%s min) exceeds time since task creation (%s min)',
            p_declared_minutes, v_minutes_since_created::integer
        );
    END IF;

    INSERT INTO public.task_manual_time_entries
        (task_id, stage_id, user_id, company_id, declared_minutes, reason,
         is_flagged, flag_reason, pending_transition_id, worked_date)
    VALUES
        (p_task_id, p_stage_id, v_user_id, v_company_id, p_declared_minutes, p_reason,
         v_is_flagged, v_flag_reason, p_transition_id, v_worked_date)
    ON CONFLICT (task_id, stage_id, user_id) DO UPDATE
        SET declared_minutes      = EXCLUDED.declared_minutes,
            reason                = EXCLUDED.reason,
            is_flagged            = EXCLUDED.is_flagged,
            flag_reason           = EXCLUDED.flag_reason,
            pending_transition_id = EXCLUDED.pending_transition_id,
            worked_date           = EXCLUDED.worked_date,
            logged_at             = now();

    IF v_is_flagged AND v_task.manager_id IS NOT NULL THEN
        PERFORM public.fn_emit_notification_event(
            'task.manual_time_flagged', 'task', p_task_id, v_user_id,
            jsonb_build_object(
                'declared_minutes', p_declared_minutes,
                'flag_reason',      v_flag_reason,
                'stage_id',         p_stage_id,
                'manager_id',       v_task.manager_id
            )
        );
    END IF;

    PERFORM public.log_event(
        v_company_id, v_user_id, 'task', p_task_id, 'task.manual_time_logged',
        jsonb_build_object(
            'declared_minutes', p_declared_minutes,
            'is_flagged',       v_is_flagged,
            'stage_id',         p_stage_id,
            'worked_date',      v_worked_date
        )
    );

    -- Approval is always required from the manager — return 'pending'.
    RETURN jsonb_build_object(
        'success',         true,
        'is_flagged',      v_is_flagged,
        'flag_reason',     v_flag_reason,
        'approval_status', 'pending'
    );
END;
$$;

-- ── rpc_review_manual_time: backdate the session onto worked_date
-- instead of the submission/approval timestamp ─────────────────
CREATE OR REPLACE FUNCTION public.rpc_review_manual_time(
    p_entry_id         UUID,
    p_approve          BOOLEAN,
    p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id           UUID := auth.uid();
    v_is_owner          BOOLEAN := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
    v_entry             RECORD;
    v_session_id        UUID;
    v_session_start     TIMESTAMPTZ;
    v_session_end       TIMESTAMPTZ;
    v_target_stage_id   UUID;
BEGIN
    SELECT
        e.id, e.task_id, e.stage_id, e.user_id, e.company_id,
        e.declared_minutes, e.logged_at, e.worked_date, e.approval_status,
        e.pending_transition_id,
        t.created_by AS task_created_by,
        t.manager_id AS task_manager_id,
        t.title      AS task_title
    INTO v_entry
    FROM public.task_manual_time_entries e
    JOIN public.tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    WHERE e.id = p_entry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manual time entry not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_entry.company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    IF NOT (
        v_is_owner
        OR v_entry.task_manager_id = v_user_id
        OR v_entry.task_created_by = v_user_id
        OR public.has_permission('task.manage')
    ) THEN
        RAISE EXCEPTION 'Forbidden: only the task manager or company owners can review manual time.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_entry.id::text));

    IF p_approve THEN
        IF v_entry.approval_status = 'approved' THEN
            RETURN jsonb_build_object('success', true, 'approval_status', 'approved', 'session_created', false);
        END IF;

        IF v_entry.approval_status = 'rejected' THEN
            RAISE EXCEPTION 'This manual time entry has already been rejected.' USING ERRCODE = 'P0001';
        END IF;

        -- Anchor on the declared work date (keeping the original submission's
        -- time-of-day) rather than `logged_at`, so time declared for a day
        -- other than today doesn't land in "today" once approved.
        v_session_end   := (v_entry.worked_date + v_entry.logged_at::time)::timestamptz;
        v_session_start := v_session_end - make_interval(mins => v_entry.declared_minutes);

        UPDATE public.task_manual_time_entries
        SET approval_status  = 'approved',
            rejection_reason = NULL,
            approved_at      = now(),
            approved_by      = v_user_id
        WHERE id = p_entry_id;

        INSERT INTO public.task_work_sessions (
            user_id, task_id, company_id, stage_id,
            started_at, last_heartbeat_at, completed_at,
            status, total_seconds_spent
        )
        VALUES (
            v_entry.user_id, v_entry.task_id, v_entry.company_id, v_entry.stage_id,
            v_session_start, v_session_end, v_session_end,
            'completed', v_entry.declared_minutes * 60
        )
        RETURNING id INTO v_session_id;

        IF v_entry.pending_transition_id IS NOT NULL THEN
            SELECT to_stage_id INTO v_target_stage_id
            FROM public.pipeline_stage_transitions
            WHERE id = v_entry.pending_transition_id;

            IF v_target_stage_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(v_entry.task_id, v_target_stage_id);
            END IF;
        END IF;

        PERFORM public.fn_emit_notification_event(
            'task.manual_time_approved', 'task', v_entry.task_id, v_user_id,
            jsonb_build_object(
                'task_id',          v_entry.task_id,
                'stage_id',         v_entry.stage_id,
                'entry_id',         v_entry.id,
                'worker_id',        v_entry.user_id,
                'declared_minutes', v_entry.declared_minutes,
                'session_id',       v_session_id,
                'stage_advanced',   v_entry.pending_transition_id IS NOT NULL
            )
        );

        RETURN jsonb_build_object(
            'success',         true,
            'approval_status', 'approved',
            'session_created', true,
            'session_id',      v_session_id,
            'stage_advanced',  v_entry.pending_transition_id IS NOT NULL
        );
    END IF;

    -- Reject path
    IF v_entry.approval_status = 'rejected' THEN
        RETURN jsonb_build_object('success', true, 'approval_status', 'rejected', 'session_created', false);
    END IF;

    UPDATE public.task_manual_time_entries
    SET approval_status  = 'rejected',
        rejection_reason = p_rejection_reason,
        approved_at      = now(),
        approved_by      = v_user_id
    WHERE id = p_entry_id;

    PERFORM public.fn_emit_notification_event(
        'task.manual_time_rejected', 'task', v_entry.task_id, v_user_id,
        jsonb_build_object(
            'task_id',          v_entry.task_id,
            'stage_id',         v_entry.stage_id,
            'entry_id',         v_entry.id,
            'worker_id',        v_entry.user_id,
            'rejection_reason', p_rejection_reason
        )
    );

    RETURN jsonb_build_object('success', true, 'approval_status', 'rejected', 'session_created', false);
END;
$$;
