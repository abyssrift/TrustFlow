INSERT INTO public.permissions (key, label, description, category, is_system)
VALUES (
  'task.view_detail',
  'View Task Details',
  'View task details without company-wide view-all access.',
  'tasks',
  true
)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_system = EXCLUDED.is_system;

CREATE OR REPLACE FUNCTION public.rpc_get_task_details(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id                UUID := auth.uid();
  v_company_id             UUID;
  v_is_owner               BOOLEAN;
  v_is_creator             BOOLEAN;
  v_is_manager             BOOLEAN;
  v_is_assigned            BOOLEAN;
  v_task                   RECORD;
  v_pipeline               JSONB;
  v_current_stage          JSONB;
  v_all_stages             JSONB;
  v_transitions            JSONB;
  v_creator                JSONB;
  v_manager                JSONB;
  v_assignments            JSONB;
  v_stage_history          JSONB;
  v_submissions            JSONB;
  v_comments               JSONB;
  v_work_sessions          JSONB;
  v_activity               JSONB;
  v_stats                  JSONB;
  v_permissions            JSONB;
  v_can_view_hist          BOOLEAN;
  v_stage_actions          JSONB;
  v_task_attachments       JSONB;
  v_pending_time_approvals JSONB;
  v_my_manual_time_entry   JSONB;
BEGIN
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_task IS NULL THEN
    RETURN NULL;
  END IF;

  v_company_id := v_task.company_id;

  IF v_company_id != public.my_company_id() THEN
    RETURN NULL;
  END IF;

  v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
  v_is_creator := v_task.created_by = v_user_id;
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

  IF NOT (
    v_is_owner
    OR v_is_creator
    OR v_is_manager
    OR v_is_assigned
    OR public.has_permission('system.view_all_data')
    OR public.has_permission('task.view_all')
    OR public.has_permission('task.view_detail')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description)
  INTO v_pipeline
  FROM public.pipelines p WHERE p.id = v_task.pipeline_id;

  SELECT jsonb_build_object(
    'id', ps.id, 'name', ps.name, 'color', ps.color,
    'position', ps.position, 'is_initial', ps.is_initial,
    'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type,
    'requires_submission', ps.requires_submission,
    'requires_timer', ps.requires_timer,
    'requires_attachments', ps.requires_attachments,
    'linked_pipeline_id', ps.linked_pipeline_id,
    'linked_pipeline', CASE WHEN ps.linked_pipeline_id IS NOT NULL THEN
      (SELECT jsonb_build_object('id', lp.id, 'name', lp.name) FROM public.pipelines lp WHERE lp.id = ps.linked_pipeline_id)
    ELSE NULL END
  )
  INTO v_current_stage
  FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', ps.id, 'name', ps.name, 'color', ps.color, 'position', ps.position,
                       'is_initial', ps.is_initial, 'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type,
                       'requires_submission', ps.requires_submission, 'requires_attachments', ps.requires_attachments,
                       'linked_pipeline_id', ps.linked_pipeline_id)
    ORDER BY ps.position
  ), '[]'::jsonb)
  INTO v_all_stages
  FROM public.pipeline_stages ps WHERE ps.pipeline_id = v_task.pipeline_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'to_stage_id', t.to_stage_id,
      'to_stage_name', ps.name, 'to_stage_color', ps.color,
      'label', t.label, 'transition_type', t.transition_type,
      'required_permission', t.required_permission
    )
  ), '[]'::jsonb)
  INTO v_transitions
  FROM public.pipeline_stage_transitions t
  JOIN public.pipeline_stages ps ON ps.id = t.to_stage_id
  WHERE t.from_stage_id = v_task.current_stage_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'action_type', a.action_type,
      'label', a.label,
      'icon', a.icon,
      'style', a.style,
      'required_role', a.required_role,
      'precondition', a.precondition,
      'transition_id', a.transition_id,
      'position', a.position,
      'requires_timer', a.requires_timer,
      'can_perform', CASE
        WHEN v_is_owner THEN TRUE
        WHEN a.required_role = 'any' THEN TRUE
        WHEN a.required_role = 'assignee' AND v_is_assigned THEN TRUE
        WHEN a.required_role = 'manager' AND v_is_manager THEN TRUE
        WHEN a.required_role = 'reviewer' AND (v_is_manager OR public.has_permission('submission.review')) THEN TRUE
        WHEN a.required_role = 'creator' AND v_is_creator THEN TRUE
        WHEN public.has_permission(a.required_role) THEN TRUE
        ELSE FALSE
      END,
      'precondition_met', CASE
        WHEN a.precondition IS NULL THEN TRUE
        WHEN a.precondition = 'has_pending_submission' THEN EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending')
        WHEN a.precondition = 'no_pending_submission' THEN NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending')
        WHEN a.precondition = 'is_assigned' THEN v_is_assigned
        WHEN a.precondition = 'has_approved_submission' THEN EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved')
        WHEN a.precondition = 'has_attachment' THEN EXISTS (SELECT 1 FROM public.task_attachments WHERE task_id = p_task_id)
        WHEN a.precondition = 'all_subtasks_complete' THEN NOT EXISTS (
          SELECT 1 FROM public.tasks child
          WHERE child.parent_task_id = p_task_id
            AND child.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.pipeline_stages ps
              WHERE ps.id = child.current_stage_id
                AND ps.is_terminal = TRUE
                AND ps.terminal_type = 'success'
            )
        )
        ELSE FALSE
      END
    ) ORDER BY a.position
  ), '[]'::jsonb)
  INTO v_stage_actions
  FROM public.pipeline_stage_actions a
  WHERE a.stage_id = v_task.current_stage_id AND a.is_active = TRUE;

  SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'email', u.email)
  INTO v_creator
  FROM public.users u WHERE u.id = v_task.created_by;

  IF v_task.manager_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'email', u.email)
    INTO v_manager
    FROM public.users u WHERE u.id = v_task.manager_id;
  ELSE
    v_manager := 'null'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ta.id,
      'user', CASE WHEN ta.assignee_user_id IS NOT NULL THEN
        (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = ta.assignee_user_id)
      ELSE NULL END,
      'team', CASE WHEN ta.assignee_team_id IS NOT NULL THEN
        (SELECT jsonb_build_object(
          'id', t.id, 'name', t.name, 'color', t.color,
          'members', (SELECT jsonb_agg(jsonb_build_object('user_id', tm.user_id)) FROM public.team_members tm WHERE tm.team_id = t.id AND tm.removed_at IS NULL)
        ) FROM public.teams t WHERE t.id = ta.assignee_team_id)
      ELSE NULL END,
      'assigned_at', ta.assigned_at
    )
  ), '[]'::jsonb)
  INTO v_assignments
  FROM public.task_assignments ta WHERE ta.task_id = p_task_id;

  v_can_view_hist := v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.view_history');

  IF v_can_view_hist THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', h.id,
        'from_stage_name', h.from_stage_name,
        'to_stage_name', h.to_stage_name,
        'transitioned_by', (SELECT jsonb_build_object('full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = h.transitioned_by),
        'transitioned_at', h.transitioned_at,
        'is_reversal', h.is_reversal,
        'submission_id', h.submission_id
      )
      ORDER BY h.transitioned_at ASC
    ), '[]'::jsonb)
    INTO v_stage_history
    FROM public.pipeline_stage_history h WHERE h.task_id = p_task_id;
  ELSE
    v_stage_history := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id, 'content', s.content, 'status', s.status,
      'revision_count', s.revision_count,
      'submitted_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.submitted_by),
      'reviewed_by', CASE WHEN s.reviewed_by IS NOT NULL THEN
        (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.reviewed_by)
      ELSE NULL END,
      'review_notes', s.review_notes,
      'submitted_at', s.submitted_at,
      'reviewed_at', s.reviewed_at,
      'stage_name', (SELECT ps.name FROM public.pipeline_stages ps WHERE ps.id = s.stage_id),
      'attachments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', sa.id, 'file_name', sa.file_name, 'file_url', sa.file_url, 'mime_type', sa.mime_type, 'storage_path', sa.storage_path, 'category', sa.category, 'file_size', sa.file_size))
        FROM public.submission_attachments sa WHERE sa.submission_id = s.id
      ), '[]'::jsonb)
    )
    ORDER BY s.submitted_at DESC
  ), '[]'::jsonb)
  INTO v_submissions
  FROM public.task_submissions s WHERE s.task_id = p_task_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'content', c.content, 'parent_id', c.parent_id,
      'is_system', c.is_system, 'author', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = c.author_id),
      'created_at', c.created_at
    )
    ORDER BY c.created_at ASC
  ), '[]'::jsonb)
  INTO v_comments
  FROM public.task_comments c
  WHERE c.task_id = p_task_id AND c.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ws.id,
      'user_name', (SELECT u.full_name FROM public.users u WHERE u.id = ws.user_id),
      'user_id', ws.user_id,
      'status', ws.status,
      'total_seconds_spent', ws.total_seconds_spent,
      'started_at', ws.started_at
    )
  ), '[]'::jsonb)
  INTO v_work_sessions
  FROM public.task_work_sessions ws WHERE ws.task_id = p_task_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ae.id,
      'event_type', ae.event_type,
      'user_name', (SELECT u.full_name FROM public.users u WHERE u.id = ae.user_id),
      'metadata', ae.metadata,
      'created_at', ae.created_at
    )
    ORDER BY ae.created_at DESC
  ), '[]'::jsonb)
  INTO v_activity
  FROM (
    SELECT * FROM public.activity_events
    WHERE entity_type = 'task' AND entity_id = p_task_id
    ORDER BY created_at DESC LIMIT 50
  ) ae;

  SELECT jsonb_build_object(
    'total_transitions', (SELECT COUNT(*) FROM public.pipeline_stage_history WHERE task_id = p_task_id),
    'approval_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved'),
    'revision_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'needs_revision'),
    'rejection_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'rejected'),
    'pending_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending'),
    'total_time_spent_seconds', COALESCE((SELECT SUM(total_seconds_spent) FROM public.task_work_sessions WHERE task_id = p_task_id), 0),
    'days_in_pipeline', EXTRACT(DAY FROM (now() - v_task.created_at))::INT
  ) INTO v_stats;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ta.id,
      'file_name', ta.file_name,
      'file_url', ta.file_url,
      'file_size', ta.file_size,
      'mime_type', ta.mime_type,
      'category', ta.category,
      'uploaded_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = ta.uploaded_by),
      'created_at', ta.created_at
    )
    ORDER BY ta.created_at ASC
  ), '[]'::jsonb)
  INTO v_task_attachments
  FROM public.task_attachments ta WHERE ta.task_id = p_task_id;

  -- Pending time approvals: flagged entries awaiting manager review
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',               e.id,
      'declared_minutes', e.declared_minutes,
      'reason',           e.reason,
      'flag_reason',      e.flag_reason,
      'logged_at',        e.logged_at,
      'approval_status',  e.approval_status,
      'rejection_reason', e.rejection_reason,
      'user',             (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url)
                           FROM public.users u WHERE u.id = e.user_id)
    )
    ORDER BY e.logged_at DESC
  ), '[]'::jsonb)
  INTO v_pending_time_approvals
  FROM public.task_manual_time_entries e
  WHERE e.task_id = p_task_id
    AND e.is_flagged = true
    AND e.approval_status = 'pending';

  -- Current user's manual time entry for the active stage
  SELECT jsonb_build_object(
    'id',               e.id,
    'declared_minutes', e.declared_minutes,
    'is_flagged',       e.is_flagged,
    'approval_status',  e.approval_status,
    'rejection_reason', e.rejection_reason
  )
  INTO v_my_manual_time_entry
  FROM public.task_manual_time_entries e
  WHERE e.task_id  = p_task_id
    AND e.stage_id = v_task.current_stage_id
    AND e.user_id  = v_user_id;

  v_permissions := jsonb_build_object(
    'can_edit',         v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.edit'),
    'can_assign',       v_is_owner OR v_is_manager OR public.has_permission('task.assign'),
    'can_review',       v_is_owner OR public.has_permission('submission.review'),
    'can_view_history', v_can_view_hist,
    'can_comment',      v_is_owner OR v_is_assigned OR v_is_creator OR v_is_manager OR public.has_permission('task.comment'),
    'can_advance',      v_is_owner,
    'can_delete',       v_is_owner OR public.has_permission('task.delete'),
    'is_owner',         v_is_owner,
    'is_assigned',      v_is_assigned,
    'is_manager',       v_is_manager,
    'is_creator',       v_is_creator
  );

  RETURN jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_task.id, 'company_id', v_task.company_id, 'title', v_task.title, 'description', v_task.description,
      'status', v_task.status, 'priority', v_task.priority, 'category', v_task.category,
      'due_date', v_task.due_date, 'progress', v_task.progress, 'weight', v_task.weight,
      'is_recurring', v_task.is_recurring, 'parent_task_id', v_task.parent_task_id,
      'error_state', v_task.error_state, 'quarantine_reason', v_task.quarantine_reason,
      'created_at', v_task.created_at, 'updated_at', v_task.updated_at,
      'completed_at', v_task.completed_at,
      'visibility_permission', v_task.visibility_permission
    ),
    'pipeline',               COALESCE(v_pipeline, 'null'::jsonb),
    'current_stage',          COALESCE(v_current_stage, 'null'::jsonb),
    'all_stages',             v_all_stages,
    'available_transitions',  v_transitions,
    'stage_actions',          v_stage_actions,
    'creator',                COALESCE(v_creator, 'null'::jsonb),
    'manager',                v_manager,
    'assignments',            v_assignments,
    'stage_history',          v_stage_history,
    'submissions',            v_submissions,
    'comments',               v_comments,
    'work_sessions',          v_work_sessions,
    'activity',               v_activity,
    'stats',                  v_stats,
    'permissions',            v_permissions,
    'task_attachments',       v_task_attachments,
    'pending_time_approvals', COALESCE(v_pending_time_approvals, '[]'::jsonb),
    'my_manual_time_entry',   COALESCE(v_my_manual_time_entry, 'null'::jsonb)
  );
END;
$function$;