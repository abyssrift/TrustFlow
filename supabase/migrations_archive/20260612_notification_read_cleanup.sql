-- Delete notifications that have been read for more than 7 days.
-- Runs daily at 03:00 UTC to keep the table lean without impacting peak hours.

CREATE OR REPLACE FUNCTION public.fn_cleanup_read_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE read_at IS NOT NULL
    AND read_at < now() - INTERVAL '7 days';
END;
$$;

-- Schedule daily cleanup at 03:00 UTC
SELECT cron.unschedule('cleanup-read-notifications') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-read-notifications'
);
SELECT cron.schedule(
  'cleanup-read-notifications',
  '0 3 * * *',
  'SELECT public.fn_cleanup_read_notifications()'
);
