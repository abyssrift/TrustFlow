-- ====================================================================
-- Notification Engine: Phase 3 — DB → Edge Function bridge
-- On every INSERT to notification_events, pg_net calls the
-- process-notification-event Edge Function (async HTTP).
-- A 5-minute pg_cron sweep catches any events the trigger missed.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.fn_trg_dispatch_notification_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
  v_payload JSONB;
BEGIN
  v_payload := jsonb_build_object(
    'type',       'INSERT',
    'table',      'notification_events',
    'schema',     'public',
    'record',     row_to_json(NEW)::JSONB,
    'old_record', NULL
  );

  PERFORM net.http_post(
    url     := v_url,
    body    := v_payload,
    headers := '{"Content-Type": "application/json"}'::JSONB,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_notification_event ON public.notification_events;
CREATE TRIGGER trg_dispatch_notification_event
  AFTER INSERT ON public.notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_dispatch_notification_event();

-- ====================================================================
-- pg_cron fallback: reprocess any events the trigger missed
-- Picks up unprocessed events older than 30s (the webhook trigger
-- should have handled anything newer than that).
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_sweep_pending_notification_events()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_url   TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
BEGIN
  FOR v_event IN
    SELECT *
    FROM   public.notification_events
    WHERE  processed_at IS NULL
      AND  created_at < now() - INTERVAL '30 seconds'
    ORDER BY created_at
    LIMIT 50
  LOOP
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'type',       'INSERT',
                   'table',      'notification_events',
                   'schema',     'public',
                   'record',     row_to_json(v_event)::JSONB,
                   'old_record', NULL
                 ),
      headers := '{"Content-Type": "application/json"}'::JSONB,
      timeout_milliseconds := 5000
    );
  END LOOP;
END;
$$;

SELECT cron.unschedule('sweep-pending-notification-events') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sweep-pending-notification-events'
);
SELECT cron.schedule(
  'sweep-pending-notification-events',
  '*/5 * * * *',
  'SELECT public.fn_sweep_pending_notification_events()'
);
