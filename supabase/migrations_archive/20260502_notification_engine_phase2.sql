-- ====================================================================
-- Notification Engine: Phase 2 — PostgreSQL Event Triggers
-- Emits structured rows into notification_events on key mutations.
-- ====================================================================

-- ── Generic event emitter (called by all trigger functions) ──────────
CREATE OR REPLACE FUNCTION public.fn_emit_notification_event(
  p_event_type  TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_actor_id    UUID,
  p_payload     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_events
    (event_type, entity_type, entity_id, actor_id, payload)
  VALUES
    (p_event_type, p_entity_type, p_entity_id, p_actor_id, p_payload);
END;
$$;

-- ====================================================================
-- tasks: AFTER INSERT → task.created
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_trg_tasks_notify_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_emit_notification_event(
    'task.created',
    'task',
    NEW.id,
    NEW.created_by,
    jsonb_build_object(
      'task_id',     NEW.id,
      'pipeline_id', NEW.pipeline_id,
      'stage_id',    NEW.current_stage_id,
      'created_by',  NEW.created_by
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_notify_insert ON public.tasks;
CREATE TRIGGER trg_tasks_notify_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_tasks_notify_insert();

-- ====================================================================
-- tasks: AFTER UPDATE OF current_stage_id, status
--   → task.stage_transition  (stage moved)
--   → task.status_changed    (status changed)
--   → task.completed         (status → 'completed')
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_trg_tasks_notify_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_name TEXT;
  v_actor_id   UUID := auth.uid(); -- NULL for system/cron operations
BEGIN
  -- Stage transition
  IF OLD.current_stage_id IS DISTINCT FROM NEW.current_stage_id
     AND NEW.current_stage_id IS NOT NULL
  THEN
    SELECT name INTO v_stage_name
    FROM   public.pipeline_stages
    WHERE  id = NEW.current_stage_id;

    PERFORM public.fn_emit_notification_event(
      'task.stage_transition',
      'task',
      NEW.id,
      v_actor_id,
      jsonb_build_object(
        'task_id',       NEW.id,
        'pipeline_id',   NEW.pipeline_id,
        'from_stage_id', OLD.current_stage_id,
        'to_stage_id',   NEW.current_stage_id,
        'stage_tag',     LOWER(REPLACE(COALESCE(v_stage_name, ''), ' ', '_'))
      )
    );
  END IF;

  -- Status changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.fn_emit_notification_event(
      'task.status_changed',
      'task',
      NEW.id,
      v_actor_id,
      jsonb_build_object(
        'task_id',     NEW.id,
        'pipeline_id', NEW.pipeline_id,
        'from_status', OLD.status,
        'to_status',   NEW.status
      )
    );

    -- Completed
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
      PERFORM public.fn_emit_notification_event(
        'task.completed',
        'task',
        NEW.id,
        v_actor_id,
        jsonb_build_object(
          'task_id',      NEW.id,
          'pipeline_id',  NEW.pipeline_id,
          'completed_by', v_actor_id
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_notify_update ON public.tasks;
CREATE TRIGGER trg_tasks_notify_update
  AFTER UPDATE OF current_stage_id, status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_tasks_notify_update();

-- ====================================================================
-- task_assignments: AFTER INSERT → task.assigned
-- Only fires for user assignments (assignee_user_id NOT NULL).
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_trg_task_assignments_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
BEGIN
  IF NEW.assignee_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pipeline_id INTO v_pipeline_id
  FROM   public.tasks
  WHERE  id = NEW.task_id;

  PERFORM public.fn_emit_notification_event(
    'task.assigned',
    'task',
    NEW.task_id,
    NEW.assigned_by,
    jsonb_build_object(
      'task_id',     NEW.task_id,
      'pipeline_id', v_pipeline_id,
      'assignee_id', NEW.assignee_user_id,
      'assigned_by', NEW.assigned_by
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_assignments_notify ON public.task_assignments;
CREATE TRIGGER trg_task_assignments_notify
  AFTER INSERT ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_task_assignments_notify();

-- ====================================================================
-- task_comments: AFTER INSERT
--   → task.commented          (all non-system comments)
--   → task.mentioned per user (for each @handle found in content)
--
-- @mention matching: extracts @word tokens, looks up users by
-- display_name with spaces collapsed or replaced by underscores.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_trg_task_comments_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mention           TEXT;
  v_mentioned_user_id UUID;
BEGIN
  -- Skip system-generated comments
  IF NEW.is_system THEN
    RETURN NEW;
  END IF;

  -- task.commented
  PERFORM public.fn_emit_notification_event(
    'task.commented',
    'task',
    NEW.task_id,
    NEW.author_id,
    jsonb_build_object(
      'task_id',      NEW.task_id,
      'comment_id',   NEW.id,
      'commented_by', NEW.author_id
    )
  );

  -- task.mentioned — one event per @mentioned user found in content
  FOR v_mention IN
    SELECT DISTINCT m[1]
    FROM   regexp_matches(NEW.content, '@([A-Za-z0-9_.]+)', 'g') AS m
  LOOP
    SELECT id INTO v_mentioned_user_id
    FROM   public.users
    WHERE  LOWER(REPLACE(COALESCE(display_name, full_name, ''), ' ', '_')) = LOWER(v_mention)
       OR  LOWER(REPLACE(COALESCE(display_name, full_name, ''), ' ', ''))  = LOWER(v_mention)
    LIMIT 1;

    IF FOUND THEN
      PERFORM public.fn_emit_notification_event(
        'task.mentioned',
        'task',
        NEW.task_id,
        NEW.author_id,
        jsonb_build_object(
          'task_id',           NEW.task_id,
          'comment_id',        NEW.id,
          'mentioned_user_id', v_mentioned_user_id,
          'mentioned_by',      NEW.author_id
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_comments_notify ON public.task_comments;
CREATE TRIGGER trg_task_comments_notify
  AFTER INSERT ON public.task_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_task_comments_notify();

-- ====================================================================
-- Cron: daily overdue task scanner
-- Runs at 08:00 UTC via pg_cron.
-- Emits task.due_soon (due in next 24h) and task.overdue (past due).
-- De-duplicated per task per calendar day.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_check_overdue_tasks()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task RECORD;
BEGIN
  -- task.due_soon: due in the next 24 hours, not yet completed
  FOR v_task IN
    SELECT t.id, t.pipeline_id, t.due_date,
           ta.assignee_user_id
    FROM   public.tasks t
    LEFT JOIN LATERAL (
      SELECT assignee_user_id
      FROM   public.task_assignments
      WHERE  task_id = t.id AND assignee_user_id IS NOT NULL
      LIMIT  1
    ) ta ON TRUE
    WHERE  t.deleted_at IS NULL
      AND  t.status NOT IN ('completed', 'cancelled')
      AND  t.due_date BETWEEN now() AND now() + INTERVAL '24 hours'
      AND  NOT EXISTS (
             SELECT 1 FROM public.notification_events ne
             WHERE  ne.event_type = 'task.due_soon'
               AND  ne.entity_id  = t.id
               AND  ne.created_at >= CURRENT_DATE::TIMESTAMPTZ
           )
  LOOP
    PERFORM public.fn_emit_notification_event(
      'task.due_soon', 'task', v_task.id, NULL,
      jsonb_build_object(
        'task_id',     v_task.id,
        'pipeline_id', v_task.pipeline_id,
        'assignee_id', v_task.assignee_user_id,
        'due_at',      v_task.due_date
      )
    );
  END LOOP;

  -- task.overdue: past due (bounded to last 30 days), not already emitted today
  FOR v_task IN
    SELECT t.id, t.pipeline_id, t.due_date,
           ta.assignee_user_id
    FROM   public.tasks t
    LEFT JOIN LATERAL (
      SELECT assignee_user_id
      FROM   public.task_assignments
      WHERE  task_id = t.id AND assignee_user_id IS NOT NULL
      LIMIT  1
    ) ta ON TRUE
    WHERE  t.deleted_at IS NULL
      AND  t.status NOT IN ('completed', 'cancelled')
      AND  t.due_date < now()
      AND  t.due_date > now() - INTERVAL '30 days'
      AND  NOT EXISTS (
             SELECT 1 FROM public.notification_events ne
             WHERE  ne.event_type = 'task.overdue'
               AND  ne.entity_id  = t.id
               AND  ne.created_at >= CURRENT_DATE::TIMESTAMPTZ
           )
  LOOP
    PERFORM public.fn_emit_notification_event(
      'task.overdue', 'task', v_task.id, NULL,
      jsonb_build_object(
        'task_id',     v_task.id,
        'pipeline_id', v_task.pipeline_id,
        'assignee_id', v_task.assignee_user_id,
        'due_at',      v_task.due_date
      )
    );
  END LOOP;
END;
$$;

-- Schedule daily at 08:00 UTC (unschedule first to allow re-runs)
SELECT cron.unschedule('notify-overdue-tasks') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'notify-overdue-tasks'
);
SELECT cron.schedule(
  'notify-overdue-tasks',
  '0 8 * * *',
  'SELECT public.fn_check_overdue_tasks()'
);
