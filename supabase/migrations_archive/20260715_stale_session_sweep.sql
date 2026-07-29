-- Hourly sweep for sessions whose owner never came back (rpc_start_work's
-- orphan cleanup only fires when the same user starts a NEW session).
-- Threshold is 8h: heartbeats are visibility-gated, so a live session can
-- legitimately go hours without one (client max session = 6h). Do not lower.
-- Duration is backfilled by trg_backfill_session_duration; not computed here.

-- rpc_cleanup_stale_sessions has no client callers (repo grep) and is
-- superseded by this sweep.
DROP FUNCTION IF EXISTS public.rpc_cleanup_stale_sessions(uuid);

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
      AND last_heartbeat_at < now() - interval '8 hours';
$$;

-- Guard against double-scheduling.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-work-sessions') THEN
        PERFORM cron.unschedule('sweep-stale-work-sessions');
    END IF;
END;
$$;

SELECT cron.schedule(
    'sweep-stale-work-sessions',
    '15 * * * *',
    'SELECT public.fn_sweep_stale_work_sessions()'
);
