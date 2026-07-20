-- The 6h absolute session cap (hooks/useSmartTimer.ts SESSION_MAX_DURATION) was
-- only enforced client-side. A client that's asleep, backgrounded, or fully
-- killed never runs that JS, so those sessions rode the 8h heartbeat-staleness
-- sweep instead of closing at 6h. Mirror the cap here so it's authoritative
-- regardless of client state. Still anchors completed_at to last_heartbeat_at
-- (last proof of life), never now(), so idle time is never billed as worked.
CREATE OR REPLACE FUNCTION public.fn_sweep_stale_work_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = last_heartbeat_at,
        notes = COALESCE(notes, '') || ' [auto-closed: stale]'
    WHERE status = 'active'
      AND (
        last_heartbeat_at < now() - interval '8 hours'
        OR started_at < now() - interval '6 hours'
      );
$$;

-- Tighten cadence from hourly to every 10 minutes so the 6h cap doesn't
-- carry up to an extra hour of drift on top of it.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-work-sessions') THEN
        PERFORM cron.unschedule('sweep-stale-work-sessions');
    END IF;
END;
$$;

SELECT cron.schedule(
    'sweep-stale-work-sessions',
    '*/10 * * * *',
    'SELECT public.fn_sweep_stale_work_sessions()'
);
