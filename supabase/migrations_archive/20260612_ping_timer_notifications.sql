-- ====================================================================
-- Ping in-app notifications + Timer auto-stop notifications
-- ====================================================================
--
-- 1. rpc_ping_task — now also inserts an in-app notification row
--    for each target assignee (type = 'task.pinged').
--
-- 2. rpc_notify_timer_auto_stopped — called client-side when the
--    smart timer force-stops a session due to idle / max-session.
--    Inserts one in-app notification for the caller (type = 'timer.auto_stopped').
--
-- Both functions use SECURITY DEFINER so they can write to the
-- notifications table (which has no client-facing INSERT policy).
-- ====================================================================

-- ── 1. Extend rpc_ping_task ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_ping_task(p_task_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      UUID;
  v_user_id         UUID := auth.uid();
  v_task_manager_id UUID;
  v_has_permission  BOOLEAN;
  v_task_title      TEXT;
  v_pinger_name     TEXT;
BEGIN
  SELECT company_id, manager_id, title
  INTO   v_company_id, v_task_manager_id, v_task_title
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  v_has_permission := (
    v_task_manager_id = v_user_id
    OR public.has_permission('task.ping')
    OR (SELECT is_owner FROM public.users WHERE id = v_user_id LIMIT 1)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'Unauthorized to ping this task';
  END IF;

  SELECT COALESCE(display_name, full_name, 'Someone')
  INTO   v_pinger_name
  FROM   public.users
  WHERE  id = v_user_id;

  -- Activity log entry (drives highlight animation on task detail)
  INSERT INTO public.activity_log (task_id, company_id, user_id, event_type, metadata)
  VALUES (
    p_task_id, v_company_id, v_user_id, 'task_pinged',
    jsonb_build_object('pinged_by', v_user_id, 'pinged_at', NOW())
  );

  -- Realtime delivery rows (one per target; drives sound + live toast)
  INSERT INTO public.task_ping_targets (task_id, company_id, pinged_by, target_user_id)
  SELECT p_task_id, v_company_id, v_user_id, ta.assignee_user_id
  FROM   public.task_assignments ta
  WHERE  ta.task_id = p_task_id
    AND  ta.assignee_user_id IS NOT NULL
    AND  ta.assignee_user_id <> v_user_id;

  -- Persistent in-app notification (one per target; appears in the notification feed)
  INSERT INTO public.notifications (user_id, type, title, body, data, channels_sent)
  SELECT
    ta.assignee_user_id,
    'task.pinged',
    v_pinger_name || ' pinged you',
    'Needs your attention: ' || COALESCE(v_task_title, 'a task'),
    jsonb_build_object(
      'task_id',    p_task_id,
      'task_title', COALESCE(v_task_title, ''),
      'pinged_by',  v_user_id
    ),
    ARRAY['in_app']
  FROM public.task_assignments ta
  WHERE ta.task_id = p_task_id
    AND ta.assignee_user_id IS NOT NULL
    AND ta.assignee_user_id <> v_user_id;
END;
$function$;

-- ── 2. Timer auto-stop notification ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_notify_timer_auto_stopped(
  p_task_id          UUID,
  p_task_title       TEXT,
  p_duration_seconds INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_hours        INTEGER;
  v_mins         INTEGER;
  v_duration_txt TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  v_hours := p_duration_seconds / 3600;
  v_mins  := (p_duration_seconds % 3600) / 60;

  IF v_hours > 0 THEN
    v_duration_txt := v_hours || 'h ' || v_mins || 'm';
  ELSIF v_mins > 0 THEN
    v_duration_txt := v_mins || 'm';
  ELSE
    v_duration_txt := 'a moment';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data, channels_sent)
  VALUES (
    v_user_id,
    'timer.auto_stopped',
    'Timer stopped due to inactivity',
    'Your timer on "' || COALESCE(p_task_title, 'a task') || '" was stopped after ' || v_duration_txt || ' of inactivity.',
    jsonb_build_object(
      'task_id',          p_task_id,
      'task_title',       COALESCE(p_task_title, ''),
      'duration_seconds', p_duration_seconds
    ),
    ARRAY['in_app']
  );
END;
$function$;
