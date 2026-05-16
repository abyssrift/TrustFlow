-- ============================================================
-- Timer gate scope fix: apply by ASSIGNEE, not by role.
--
-- Previous behavior bypassed the gate for any user who was a
-- manager or owner. That broke the case where a manager (or
-- owner) is also the assigned worker — they could advance with
-- 0 recorded time and no manual-time modal.
--
-- New rule: the gate fires only for the assigned worker. A
-- manager/owner who is NOT assigned can still freely advance
-- the task to unblock the workflow.
--
-- Also: the per-stage time sum is now filtered to the current
-- user, so other workers' time on the same stage doesn't satisfy
-- this user's gate.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_execute_stage_action(
    p_task_id    UUID,
    p_action_id  UUID,
    p_payload    JSONB DEFAULT '{}'::jsonb
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
    v_stage_requires_timer BOOLEAN;
    v_stage_is_initial     BOOLEAN;
    v_min_timer_seconds    INTEGER;
    v_total_seconds        INTEGER;
    v_manual_entry_status  TEXT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN RAISE EXCEPTION 'Task not found or deleted'; END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized: task belongs to a different company';
    END IF;

    SELECT * INTO v_action FROM public.pipeline_stage_actions WHERE id = p_action_id AND is_active = TRUE;
    IF v_action IS NULL THEN RAISE EXCEPTION 'Action not found or inactive'; END IF;
    IF v_action.stage_id != v_task.current_stage_id THEN
        RAISE EXCEPTION 'Action does not belong to the task''s current stage';
    END IF;

    v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
    v_is_creator := v_task.created_by = v_user_id;
    v_is_manager := v_task.manager_id = v_user_id;

    SELECT id INTO v_assignment_id
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND (
        assignee_user_id = v_user_id
        OR assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
        )
      )
    LIMIT 1;
    v_is_assigned := v_assignment_id IS NOT NULL;

    IF NOT v_is_owner THEN
        CASE v_action.required_role
            WHEN 'any'      THEN NULL;
            WHEN 'assignee' THEN IF NOT v_is_assigned THEN RAISE EXCEPTION 'Only assigned users can perform this action'; END IF;
            WHEN 'manager'  THEN IF NOT v_is_manager  THEN RAISE EXCEPTION 'Only the task manager can perform this action'; END IF;
            WHEN 'reviewer' THEN
                IF NOT (v_is_manager OR public.has_permission('submission.review')) THEN
                    RAISE EXCEPTION 'Only reviewers can perform this action';
                END IF;
            WHEN 'creator'  THEN IF NOT v_is_creator  THEN RAISE EXCEPTION 'Only the task creator can perform this action'; END IF;
            ELSE IF NOT public.has_permission(v_action.required_role) THEN
                RAISE EXCEPTION 'Missing required permission: %', v_action.required_role;
            END IF;
        END CASE;
    END IF;

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
                IF NOT v_is_assigned THEN RAISE EXCEPTION 'Precondition failed: you must be assigned to this task'; END IF;
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
                    WHERE child.parent_task_id = p_task_id AND child.deleted_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM public.pipeline_stages ps
                          WHERE ps.id = child.current_stage_id AND ps.is_terminal = TRUE AND ps.terminal_type = 'success'
                      )
                ) THEN
                    RAISE EXCEPTION 'Precondition failed: not all subtasks are completed';
                END IF;
            ELSE NULL;
        END CASE;
    END IF;

    -- Timer gate: advance actions only.
    -- Applies to the ASSIGNED worker. A manager/owner who is not assigned
    -- bypasses the gate to keep workflow moving. An assigned worker who also
    -- happens to be manager/owner must still declare their time.
    SELECT COALESCE(ps.requires_timer, false),
           COALESCE(ps.is_initial, false),
           COALESCE(ps.min_timer_seconds, 300)
    INTO v_stage_requires_timer, v_stage_is_initial, v_min_timer_seconds
    FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

    IF v_stage_requires_timer
       AND NOT v_stage_is_initial
       AND v_is_assigned
       AND v_min_timer_seconds > 0
       AND v_action.action_type = 'advance'
    THEN
        SELECT COALESCE(SUM(
            CASE
                WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                ELSE 0
            END
        ), 0) INTO v_total_seconds
        FROM public.task_work_sessions
        WHERE task_id  = p_task_id
          AND user_id  = v_user_id
          AND stage_id = v_task.current_stage_id;

        IF v_total_seconds < v_min_timer_seconds THEN
            SELECT approval_status INTO v_manual_entry_status
            FROM public.task_manual_time_entries
            WHERE task_id = p_task_id AND stage_id = v_task.current_stage_id AND user_id = v_user_id
            ORDER BY logged_at DESC
            LIMIT 1;

            IF v_manual_entry_status IS NULL OR v_manual_entry_status = 'rejected' THEN
                RAISE EXCEPTION 'LOW_TIMER_TIME: Less than the required minimum time was logged for this stage. Please declare your actual work hours before proceeding.'
                USING ERRCODE = 'P0001';
            ELSIF v_manual_entry_status = 'pending' THEN
                RAISE EXCEPTION 'TIME_APPROVAL_PENDING: Your time declaration is awaiting manager approval. The stage will advance automatically once approved.'
                USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END IF;

    CASE v_action.action_type
        WHEN 'start_task' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'start_task');

        WHEN 'submit_work' THEN
            v_sub_id := public.rpc_submit_work(p_task_id, COALESCE(p_payload->>'content', ''),
                v_assignment_id, v_action.transition_id, COALESCE(p_payload->'attachments', '[]'::jsonb));
            RETURN jsonb_build_object('success', true, 'action', 'submit_work', 'submission_id', v_sub_id);

        WHEN 'advance' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'advance');

        WHEN 'review_approve' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'approved', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_approve');

        WHEN 'review_reject' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'rejected', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_reject');

        WHEN 'review_revise' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'needs_revision', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_revise');

        WHEN 'start_timer' THEN
            INSERT INTO public.task_work_sessions (task_id, user_id, company_id, stage_id, status)
            VALUES (p_task_id, v_user_id, v_company_id, v_task.current_stage_id, 'active') ON CONFLICT DO NOTHING;
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
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'custom');

        ELSE RAISE EXCEPTION 'Unknown action type: %', v_action.action_type;
    END CASE;
END;
$$;
