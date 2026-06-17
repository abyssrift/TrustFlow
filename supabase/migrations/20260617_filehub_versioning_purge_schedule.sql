-- 20260617_filehub_versioning_purge_schedule.sql
-- FileHub Version Control — Phase 2: daily purge schedule
--
-- This file mirrors the migration applied live via Supabase MCP
-- (`schedule_purge_filehub_versions_daily`), kept here for repo parity so the
-- schedule is reproducible in a fresh environment.
--
-- It schedules a daily pg_cron job that POSTs (via pg_net) to the
-- `purge-filehub-versions` Edge Function, which deletes superseded FileHub
-- file versions older than 30 days plus their storage objects. The current
-- version of every file (superseded_at IS NULL) is never purged.
--
-- Additive only: enables extensions (no-op if present), creates one wrapper
-- function, and (re)schedules one named cron job. Touches no app tables.
--
-- !! MANUAL STEP for authenticated invocation (optional but recommended):
--    Generate one shared secret and set it in BOTH places so they match:
--      1. Edge Function secret  PURGE_FILEHUB_SECRET  (Dashboard → Edge Functions → Secrets)
--      2. Vault:  SELECT vault.create_secret('<value>', 'purge_filehub_secret');
--    Until set, the function accepts unauthenticated calls and the cron job
--    sends an empty Bearer token. Blast radius is limited (the function only
--    ever purges already-eligible >30d superseded versions), but set the
--    secret before any versions age past the 30-day window.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Wrapper: reads the shared secret from Vault and invokes the Edge Function.
CREATE OR REPLACE FUNCTION public.fn_invoke_purge_filehub_versions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/purge-filehub-versions';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'purge_filehub_secret'
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

-- Idempotent (re)schedule: drop any same-named job, then schedule daily 03:30 UTC.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-filehub-versions-daily';
SELECT cron.schedule(
  'purge-filehub-versions-daily',
  '30 3 * * *',
  $$SELECT public.fn_invoke_purge_filehub_versions();$$
);
