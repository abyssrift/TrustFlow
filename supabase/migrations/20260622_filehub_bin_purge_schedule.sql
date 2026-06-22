-- 20260622_filehub_bin_purge_schedule.sql
-- FileHub Bin — daily purge schedule
--
-- Mirrors the existing purge-filehub-versions schedule. Schedules a daily
-- pg_cron job that POSTs (via pg_net) to the `purge-filehub-bin` Edge
-- Function, which permanently deletes FileHub files (storage objects for
-- every version, plus the row and all FK-cascaded children) once they have
-- sat in the Bin for more than 15 days (deleted_at < now() - 15 days).
--
-- Files that are merely "hidden" from someone's inbox (filehub_recipients.
-- archived_at) are never touched by the purge — hiding never destroys data
-- for anyone, so there's nothing to clean up. They simply stop appearing in
-- rpc_filehub_bin_list / stop being restorable via rpc_filehub_restore once
-- archived_at falls outside the 15-day window.
--
-- !! MANUAL STEP for authenticated invocation (optional but recommended):
--    Generate one shared secret and set it in BOTH places so they match:
--      1. Edge Function secret  PURGE_FILEHUB_BIN_SECRET  (Dashboard → Edge Functions → Secrets)
--      2. Vault:  SELECT vault.create_secret('<value>', 'purge_filehub_bin_secret');
--    Until set, the function accepts unauthenticated calls and the cron job
--    sends an empty Bearer token. Blast radius is limited (the function only
--    ever purges already-eligible >15d deleted files), but set the secret
--    before relying on this in production.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.fn_invoke_purge_filehub_bin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/purge-filehub-bin';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'purge_filehub_bin_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 30000
  );
END;
$function$;

-- Idempotent (re)schedule: drop any same-named job, then schedule daily 03:45 UTC
-- (15 minutes after the version purge, to avoid both jobs hitting storage at once).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-filehub-bin-daily';
SELECT cron.schedule(
  'purge-filehub-bin-daily',
  '45 3 * * *',
  $$SELECT public.fn_invoke_purge_filehub_bin();$$
);
