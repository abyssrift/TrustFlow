-- ============================================================
-- Smart Timer: Minimum Time Check + Manual Declaration System
-- ============================================================

-- 1. Manual time entries table
CREATE TABLE IF NOT EXISTS public.task_manual_time_entries (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id          UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    stage_id         UUID        NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id       UUID        NOT NULL,
    declared_minutes INTEGER     NOT NULL CHECK (declared_minutes > 0 AND declared_minutes <= 1440),
    reason           TEXT,
    logged_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_flagged       BOOLEAN     NOT NULL DEFAULT false,
    flag_reason      TEXT,
    UNIQUE (task_id, stage_id, user_id)
);

ALTER TABLE public.task_manual_time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own manual time entries"            ON public.task_manual_time_entries;
DROP POLICY IF EXISTS "Managers see all manual time entries in company" ON public.task_manual_time_entries;

-- Workers can only see their own entries
CREATE POLICY "Users see own manual time entries"
    ON public.task_manual_time_entries FOR SELECT
    USING (auth.uid() = user_id);

-- Managers/owners can see all entries in their company
CREATE POLICY "Managers see all manual time entries in company"
    ON public.task_manual_time_entries FOR SELECT
    USING (
        company_id = public.my_company_id()
        AND public.has_permission('task.manage')
    );

-- All mutations go through SECURITY DEFINER RPCs only (no direct DML)

-- ============================================================
-- 2. rpc_log_manual_time
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_log_manual_time(
    p_task_id          UUID,
    p_stage_id         UUID,
    p_declared_minutes INTEGER,
    p_reason           TEXT DEFAULT NULL
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
    v_is_flagged            BOOLEAN := false;
    v_flag_reason           TEXT    := NULL;
    v_estimated_minutes     NUMERIC;
    v_stage_p95_minutes     NUMERIC;
    v_minutes_since_created NUMERIC;
BEGIN
    -- Basic validation
    IF p_declared_minutes IS NULL OR p_declared_minutes <= 0 THEN
        RAISE EXCEPTION 'Declared time must be greater than 0 minutes' USING ERRCODE = 'P0001';
    END IF;
    IF p_declared_minutes > 1440 THEN
        RAISE EXCEPTION 'Declared time cannot exceed 24 hours (1440 minutes)' USING ERRCODE = 'P0001';
    END IF;

    -- Fetch task
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
    END IF;

    v_company_id := v_task.company_id;

    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Must be assigned to declare time
    IF NOT EXISTS (
        SELECT 1 FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members
                WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
    ) THEN
        RAISE EXCEPTION 'You are not assigned to this task' USING ERRCODE = '42501';
    END IF;

    -- ── Fraud check 1: task estimated_hours ──────────────────
    IF v_task.estimated_hours IS NOT NULL THEN
        v_estimated_minutes := v_task.estimated_hours * 60;
        IF p_declared_minutes > v_estimated_minutes THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds task estimate (%s min)',
                p_declared_minutes,
                v_estimated_minutes::integer
            );
        END IF;
    END IF;

    -- ── Fraud check 2: pipeline stage P95 from historical sessions ──
    IF NOT v_is_flagged THEN
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.total_seconds_spent) / 60.0
        INTO v_stage_p95_minutes
        FROM public.task_work_sessions s
        JOIN public.tasks t ON t.id = s.task_id
        WHERE t.current_stage_id = p_stage_id
          AND s.status           = 'completed'
          AND s.total_seconds_spent IS NOT NULL
          AND s.total_seconds_spent > 60;

        IF v_stage_p95_minutes IS NOT NULL AND p_declared_minutes > (v_stage_p95_minutes * 2) THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds 2× stage P95 average (%s min)',
                p_declared_minutes,
                v_stage_p95_minutes::integer
            );
        END IF;
    END IF;

    -- ── Fraud check 3: temporal plausibility ─────────────────
    -- Cannot claim more time than has elapsed since the task was created
    v_minutes_since_created := EXTRACT(EPOCH FROM (now() - v_task.created_at)) / 60.0;
    IF p_declared_minutes > v_minutes_since_created THEN
        v_is_flagged  := true;
        v_flag_reason := format(
            'Declared time (%s min) exceeds time since task creation (%s min)',
            p_declared_minutes,
            v_minutes_since_created::integer
        );
    END IF;

    -- Upsert — allow workers to correct before proceeding
    INSERT INTO public.task_manual_time_entries
        (task_id, stage_id, user_id, company_id, declared_minutes, reason, is_flagged, flag_reason)
    VALUES
        (p_task_id, p_stage_id, v_user_id, v_company_id, p_declared_minutes, p_reason, v_is_flagged, v_flag_reason)
    ON CONFLICT (task_id, stage_id, user_id) DO UPDATE
        SET declared_minutes = EXCLUDED.declared_minutes,
            reason           = EXCLUDED.reason,
            is_flagged       = EXCLUDED.is_flagged,
            flag_reason      = EXCLUDED.flag_reason,
            logged_at        = now();

    -- Emit notification event if flagged and task has a manager
    IF v_is_flagged AND v_task.manager_id IS NOT NULL THEN
        PERFORM public.fn_emit_notification_event(
            'task.manual_time_flagged',
            'task',
            p_task_id,
            v_user_id,
            jsonb_build_object(
                'declared_minutes', p_declared_minutes,
                'flag_reason',      v_flag_reason,
                'stage_id',         p_stage_id,
                'manager_id',       v_task.manager_id
            )
        );
    END IF;

    -- Audit log
    PERFORM public.log_event(
        v_company_id, v_user_id, 'task', p_task_id,
        'task.manual_time_logged',
        jsonb_build_object(
            'declared_minutes', p_declared_minutes,
            'is_flagged',       v_is_flagged,
            'stage_id',         p_stage_id
        )
    );

    RETURN jsonb_build_object(
        'success',      true,
        'is_flagged',   v_is_flagged,
        'flag_reason',  v_flag_reason
    );
END;
$$;

-- ============================================================
-- 3. Rebuild rpc_execute_stage_action with LOW_TIMER_TIME gate
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_execute_stage_action(
    p_task_id   UUID,
    p_action_id UUID,
    p_payload   JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id              UUID    := auth.uid();
    v_company_id           UUID;
    v_task                 RECORD;
    v_action               RECORD;
    v_is_owner             BOOLEAN;
    v_is_assigned          BOOLEAN;
    v_is_manager           BOOLEAN;
    v_is_creator           BOOLEAN;
    v_sub_id               UUID;
    v_assignment_id        UUID;
    -- smart timer check
    v_stage_requires_timer BOOLEAN;
    v_stage_is_initial     BOOLEAN;
    v_total_seconds        INTEGER;
    v_has_manual_entry     BOOLEAN;
BEGIN
    -- 1. Fetch task
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'Task not found or deleted';
    END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized: task belongs to a different company';
    END IF;

    -- 2. Fetch action definition
    SELECT * INTO v_action
    FROM public.pipeline_stage_actions
    WHERE id = p_action_id AND is_active = TRUE;

    IF v_action IS NULL THEN
        RAISE EXCEPTION 'Action not found or inactive';
    END IF;

    IF v_action.stage_id != v_task.current_stage_id THEN
        RAISE EXCEPTION 'Action does not belong to the task''s current stage';
    END IF;

    -- 3. Evaluate roles
    v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
    v_is_creator := v_task.created_by = v_user_id;
    v_is_manager := v_task.manager_id = v_user_id;

    SELECT id INTO v_assignment_id
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND (
        assignee_user_id = v_user_id
        OR assignee_team_id IN (
            SELECT team_id FROM public.team_members
            WHERE user_id = v_user_id AND removed_at IS NULL
        )
      )
    LIMIT 1;

    v_is_assigned := v_assignment_id IS NOT NULL;

    IF NOT v_is_owner THEN
        CASE v_action.required_role
            WHEN 'any' THEN NULL;
            WHEN 'assignee' THEN
                IF NOT v_is_assigned THEN
                    RAISE EXCEPTION 'Only assigned users can perform this action';
                END IF;
            WHEN 'manager' THEN
                IF NOT v_is_manager THEN
                    RAISE EXCEPTION 'Only the task manager can perform this action';
                END IF;
            WHEN 'reviewer' THEN
                IF NOT (v_is_manager OR public.has_permission('submission.review')) THEN
                    RAISE EXCEPTION 'Only reviewers can perform this action';
                END IF;
            WHEN 'creator' THEN
                IF NOT v_is_creator THEN
                    RAISE EXCEPTION 'Only the task creator can perform this action';
                END IF;
            ELSE
                IF NOT public.has_permission(v_action.required_role) THEN
                    RAISE EXCEPTION 'Missing required permission: %', v_action.required_role;
                END IF;
        END CASE;
    END IF;

    -- 4. Evaluate preconditions
    IF v_action.precondition IS NOT NULL THEN
        CASE v_action.precondition
            WHEN 'has_pending_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: no pending submission exists';
                END IF;
            WHEN 'no_pending_submission' THEN
                IF EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: a pending submission already exists';
                END IF;
            WHEN 'is_assigned' THEN
                IF NOT v_is_assigned THEN
                    RAISE EXCEPTION 'Precondition failed: you must be assigned to this task';
                END IF;
            WHEN 'has_approved_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved') THEN
                    RAISE EXCEPTION 'Precondition failed: no approved submission exists';
                END IF;
            WHEN 'has_attachment' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_attachments WHERE task_id = p_task_id) THEN
                    RAISE EXCEPTION 'Precondition failed: task has no attachments';
                END IF;
            WHEN 'all_subtasks_complete' THEN
                IF EXISTS (
                    SELECT 1 FROM public.tasks child
                    WHERE child.parent_task_id = p_task_id
                      AND child.deleted_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM public.pipeline_stages ps
                          WHERE ps.id = child.current_stage_id
                            AND ps.is_terminal = TRUE
                            AND ps.terminal_type = 'success'
                      )
                ) THEN
                    RAISE EXCEPTION 'Precondition failed: not all subtasks are completed';
                END IF;
            ELSE NULL;
        END CASE;
    END IF;

    -- 4.5 Smart timer minimum time gate
    -- Applies only to: timer-required stages, non-initial stages,
    -- actions that transition stage (have transition_id or are submit_work),
    -- and only for non-owner, non-manager users.
    SELECT
        COALESCE(ps.requires_timer, false),
        COALESCE(ps.is_initial, false)
    INTO v_stage_requires_timer, v_stage_is_initial
    FROM public.pipeline_stages ps
    WHERE ps.id = v_task.current_stage_id;

    IF v_stage_requires_timer
       AND NOT v_stage_is_initial
       AND NOT v_is_owner
       AND NOT v_is_manager
       AND (v_action.transition_id IS NOT NULL OR v_action.action_type = 'submit_work')
    THEN
        -- Sum seconds across all sessions for this task (completed + live active)
        SELECT COALESCE(SUM(
            CASE
                WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                ELSE 0
            END
        ), 0)
        INTO v_total_seconds
        FROM public.task_work_sessions
        WHERE task_id = p_task_id;

        -- Check for an existing manual declaration for this task+stage by this user
        SELECT EXISTS(
            SELECT 1 FROM public.task_manual_time_entries
            WHERE task_id  = p_task_id
              AND stage_id = v_task.current_stage_id
              AND user_id  = v_user_id
        ) INTO v_has_manual_entry;

        IF v_total_seconds < 300 AND NOT v_has_manual_entry THEN
            RAISE EXCEPTION 'LOW_TIMER_TIME: Less than 5 minutes logged for this stage. Please declare your actual work hours before proceeding.'
            USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 5. Dispatch
    CASE v_action.action_type
        WHEN 'start_task' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id)
                );
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'start_task');

        WHEN 'submit_work' THEN
            v_sub_id := public.rpc_submit_work(
                p_task_id,
                COALESCE(p_payload->>'content', ''),
                v_assignment_id,
                v_action.transition_id,
                COALESCE(p_payload->'attachments', '[]'::jsonb)
            );
            RETURN jsonb_build_object('success', true, 'action', 'submit_work', 'submission_id', v_sub_id);

        WHEN 'advance' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id)
                );
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'advance');

        WHEN 'review_approve' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending'
            ORDER BY submitted_at DESC LIMIT 1;

            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'approved', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id)
                );
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_approve');

        WHEN 'review_reject' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending'
            ORDER BY submitted_at DESC LIMIT 1;

            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'rejected', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id)
                );
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_reject');

        WHEN 'review_revise' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending'
            ORDER BY submitted_at DESC LIMIT 1;

            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'needs_revision', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id)
                );
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_revise');

        WHEN 'start_timer' THEN
            INSERT INTO public.task_work_sessions (task_id, user_id, company_id, status)
            VALUES (p_task_id, v_user_id, v_company_id, 'active')
            ON CONFLICT DO NOTHING;
            PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.timer_started',
                jsonb_build_object('action_id', p_action_id));
            RETURN jsonb_build_object('success', true, 'action', 'start_timer');

        WHEN 'assign_user' THEN
            IF p_payload->>'assign_user_id' IS NOT NULL THEN
                INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
                VALUES (p_task_id, v_company_id, (p_payload->>'assign_user_id')::UUID, v_user_id)
                ON CONFLICT DO NOTHING;
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'assign_user');

        WHEN 'custom' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id)
                );
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'custom');

        ELSE
            RAISE EXCEPTION 'Unknown action type: %', v_action.action_type;
    END CASE;
END;
$$;
