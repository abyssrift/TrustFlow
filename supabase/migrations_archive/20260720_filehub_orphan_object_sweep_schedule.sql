-- 20260720_filehub_orphan_object_sweep_schedule.sql
-- Daily sweep of orphaned FileHub storage objects.
--
-- Mirrors the purge-filehub-bin schedule. Schedules a daily pg_cron job that
-- POSTs (via pg_net) to the `filehub-orphan-sweep` Edge Function, which deletes
-- objects in the `filehub-files` bucket that NOTHING in the DB references
-- (no filehub_files row and no filehub_file_versions row with that
-- storage_path) and that are older than 24h. Those are bytes left behind when
-- an upload's commit never completed (client died between the storage PUT and
-- rpc_filehub_upload_commit).
--
-- Referenced objects — live files, files sitting in the 15-day Bin, and every
-- historical version — are never touched: the function checks BOTH storage_path
-- tables before removing anything, and the 24h age floor keeps it clear of
-- in-flight uploads.
--
-- !! MANUAL STEP for authenticated invocation (optional but recommended):
--    Generate one shared secret and set it in BOTH places so they match:
--      1. Edge Function secret  FILEHUB_ORPHAN_SWEEP_SECRET  (Dashboard -> Edge Functions -> Secrets)
--      2. Vault:  SELECT vault.create_secret('<value>', 'filehub_orphan_sweep_secret');
--    Until set, the function accepts unauthenticated calls and the cron job
--    sends an empty Bearer token. Blast radius is limited (the function only
--    ever removes objects already unreferenced for >24h), but set the secret
--    before relying on this in production.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.fn_invoke_filehub_orphan_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/filehub-orphan-sweep';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'filehub_orphan_sweep_secret'
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

-- Idempotent (re)schedule: drop any same-named job, then schedule daily 04:15
-- UTC (after the 03:45 bin purge, so the two never hit storage simultaneously).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'filehub-orphan-sweep-daily';
SELECT cron.schedule(
  'filehub-orphan-sweep-daily',
  '15 4 * * *',
  $$SELECT public.fn_invoke_filehub_orphan_sweep();$$
);
