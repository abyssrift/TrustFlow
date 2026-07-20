-- Audit follow-up on fn_sweep_stale_work_sessions (server_side_session_cap migration):
--
-- 1. Business-hours drift: the sweep used raw wall-clock duration even for
--    stages with use_business_hours=true, unlike rpc_stop_work which uses
--    fn_calculate_business_duration(). An auto-closed session on such a
--    stage could be credited more time than a manual stop on the same task.
-- 2. Silent auto-close: the client path notifies the user via
--    rpc_notify_timer_auto_stopped when it force-stops a timer; the sweep
--    had no equivalent, so a session closed only because the client was
--    dead/backgrounded left the worker with zero signal it happened.
-- 3. notes drift: repeated resume -> re-close cycles could stack the
--    "[auto-closed: stale]" tag multiple times.

-- Accept an explicit target user, defaulting to auth.uid() so existing
-- client callers (TimerContext.tsx, no p_user_id) are unaffected — only the
-- sweep (no auth context) needs to pass it explicitly.
CREATE OR REPLACE FUNCTION public.rpc_notify_timer_auto_stopped(
    p_task_id uuid,
    p_task_title text,
    p_duration_seconds integer,
    p_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id      UUID := COALESCE(p_user_id, auth.uid());
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
$$;

CREATE OR REPLACE FUNCTION public.fn_sweep_stale_work_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_closed RECORD;
BEGIN
    FOR v_closed IN
        UPDATE public.task_work_sessions tws
        SET status = 'completed',
            completed_at = tws.last_heartbeat_at,
            total_seconds_spent = GREATEST(
                1,
                EXTRACT(EPOCH FROM (
                    CASE WHEN COALESCE(ps.use_business_hours, false)
                         THEN public.fn_calculate_business_duration(tws.started_at, tws.last_heartbeat_at)
                         ELSE tws.last_heartbeat_at - tws.started_at
                    END
                ))::int
            ),
            notes = CASE
                        WHEN tws.notes LIKE '%[auto-closed: stale]%' THEN tws.notes
                        ELSE COALESCE(tws.notes, '') || ' [auto-closed: stale]'
                    END
        FROM public.tasks t
        LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
        WHERE t.id = tws.task_id
          AND tws.status = 'active'
          AND (
            tws.last_heartbeat_at < now() - interval '8 hours'
            OR tws.started_at < now() - interval '6 hours'
          )
        RETURNING tws.user_id, tws.task_id, t.title AS task_title, tws.total_seconds_spent
    LOOP
        PERFORM public.rpc_notify_timer_auto_stopped(
            v_closed.task_id,
            v_closed.task_title,
            v_closed.total_seconds_spent,
            v_closed.user_id
        );
    END LOOP;
END;
$$;
