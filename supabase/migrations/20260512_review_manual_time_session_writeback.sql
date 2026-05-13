-- ============================================================
-- Manual time review: persist approval into work sessions
-- ============================================================

ALTER TABLE public.task_manual_time_entries
    ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.task_manual_time_entries
    ALTER COLUMN approval_status SET DEFAULT 'pending';

ALTER TABLE public.task_manual_time_entries
    ALTER COLUMN approval_status SET NOT NULL;

ALTER TABLE public.task_manual_time_entries
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE public.task_manual_time_entries
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.task_manual_time_entries
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.task_manual_time_entries
    DROP CONSTRAINT IF EXISTS task_manual_time_entries_approval_status_check;

ALTER TABLE public.task_manual_time_entries
    ADD CONSTRAINT task_manual_time_entries_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));

UPDATE public.task_manual_time_entries
SET approval_status = 'pending'
WHERE approval_status IS NULL;

CREATE OR REPLACE FUNCTION public.fn_reset_manual_time_review_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.declared_minutes IS DISTINCT FROM OLD.declared_minutes
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.flag_reason IS DISTINCT FROM OLD.flag_reason
       OR NEW.logged_at IS DISTINCT FROM OLD.logged_at
    THEN
        NEW.approval_status := 'pending';
        NEW.rejection_reason := NULL;
        NEW.reviewed_at := NULL;
        NEW.reviewed_by := NULL;
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_reset_manual_time_review_state ON public.task_manual_time_entries;

CREATE TRIGGER trg_reset_manual_time_review_state
    BEFORE UPDATE ON public.task_manual_time_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_reset_manual_time_review_state();

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
    v_user_id         UUID := auth.uid();
    v_is_owner        BOOLEAN := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
    v_entry           RECORD;
    v_session_id      UUID;
    v_session_start   TIMESTAMPTZ;
    v_session_end     TIMESTAMPTZ;
BEGIN
    SELECT
        e.id,
        e.task_id,
        e.stage_id,
        e.user_id,
        e.company_id,
        e.declared_minutes,
        e.logged_at,
        e.approval_status,
        t.created_by AS task_created_by,
        t.manager_id AS task_manager_id,
        t.title AS task_title
    INTO v_entry
    FROM public.task_manual_time_entries e
    JOIN public.tasks t
      ON t.id = e.task_id
     AND t.deleted_at IS NULL
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
            RETURN jsonb_build_object(
                'success', true,
                'approval_status', 'approved',
                'session_created', false
            );
        END IF;

        IF v_entry.approval_status = 'rejected' THEN
            RAISE EXCEPTION 'This manual time entry has already been rejected.' USING ERRCODE = 'P0001';
        END IF;

        v_session_end := v_entry.logged_at;
        v_session_start := v_session_end - make_interval(mins => v_entry.declared_minutes);

        UPDATE public.task_manual_time_entries
        SET approval_status = 'approved',
            rejection_reason = NULL,
            reviewed_at = now(),
            reviewed_by = v_user_id
        WHERE id = p_entry_id;

        INSERT INTO public.task_work_sessions (
            user_id,
            task_id,
            started_at,
            last_heartbeat_at,
            status
        )
        VALUES (
            v_entry.user_id,
            v_entry.task_id,
            v_session_start,
            v_session_end,
            'completed'
        )
        RETURNING id INTO v_session_id;

        PERFORM public.fn_emit_notification_event(
            'task.manual_time_approved',
            'task',
            v_entry.task_id,
            v_user_id,
            jsonb_build_object(
                'task_id', v_entry.task_id,
                'stage_id', v_entry.stage_id,
                'entry_id', v_entry.id,
                'worker_id', v_entry.user_id,
                'declared_minutes', v_entry.declared_minutes,
                'session_id', v_session_id
            )
        );

        RETURN jsonb_build_object(
            'success', true,
            'approval_status', 'approved',
            'session_created', true,
            'session_id', v_session_id
        );
    END IF;

    IF v_entry.approval_status = 'rejected' THEN
        RETURN jsonb_build_object(
            'success', true,
            'approval_status', 'rejected',
            'session_created', false
        );
    END IF;

    UPDATE public.task_manual_time_entries
    SET approval_status = 'rejected',
        rejection_reason = p_rejection_reason,
        reviewed_at = now(),
        reviewed_by = v_user_id
    WHERE id = p_entry_id;

    PERFORM public.fn_emit_notification_event(
        'task.manual_time_rejected',
        'task',
        v_entry.task_id,
        v_user_id,
        jsonb_build_object(
            'task_id', v_entry.task_id,
            'stage_id', v_entry.stage_id,
            'entry_id', v_entry.id,
            'worker_id', v_entry.user_id,
            'rejection_reason', p_rejection_reason
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'approval_status', 'rejected',
        'session_created', false
    );
END;
$$;