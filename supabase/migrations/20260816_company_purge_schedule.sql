-- 20260816_company_purge_schedule.sql
-- #192 — company purge daily schedule
--
-- Mirrors the existing purge-filehub-bin schedule (20260622_filehub_bin_purge_schedule.sql).
-- Schedules a daily pg_cron job that POSTs (via pg_net) to the
-- `purge-company` Edge Function, which permanently purges (via
-- fn_purge_company_data, see 20260816_company_purge_unification.sql) every
-- company that was soft-deleted by rpc_platform_soft_delete_company more
-- than 30 days ago (deleted_at < now() - 30 days) and is still in that
-- state — i.e. never restored via rpc_platform_restore_company.
--
-- !! MANUAL STEP, REQUIRED for the sweep to do anything:
--    Generate one shared secret and set it in BOTH places so they match:
--      1. Edge Function secret  PURGE_EXPIRED_COMPANIES_SECRET  (Dashboard → Edge Functions → Secrets)
--      2. Vault:  SELECT vault.create_secret('<value>', 'purge_expired_companies_secret');
--    The edge function only treats a call as cron mode when the bearer
--    matches a NON-EMPTY PURGE_EXPIRED_COMPANIES_SECRET — with the secret
--    unset, isCron is always false and the daily cron POST gets a 401 and
--    purges nothing (fails safe, not open). Vault side was set on 2026-08-16;
--    the Edge Function secret side still needs to be pasted in manually.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.fn_invoke_purge_expired_companies()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/purge-company';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'purge_expired_companies_secret'
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

-- Idempotent (re)schedule: drop any same-named job, then schedule daily 04:30 UTC.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-expired-companies-daily';
SELECT cron.schedule(
  'purge-expired-companies-daily',
  '30 4 * * *',
  $$SELECT public.fn_invoke_purge_expired_companies();$$
);
