-- Proves the #169 patch against the bodies PRODUCTION actually has.
--
-- The local database cannot prove this on its own: five of the six invokers
-- were neutered by hand months ago, so the migration correctly skips them here
-- and the transformation is only ever exercised on one function. On production
-- it will meet all six, including the two awkward ones:
--
--   * fn_trg_dispatch_notification_event is a TRIGGER — it must still
--     RETURN NEW after the rewrite, or every notification_events INSERT fails;
--   * fn_sweep_pending_notification_events posts INSIDE a FOR loop, at a
--     different indentation, so the "close the guard after the call" step has
--     to land in the right place or the loop stops compiling.
--
-- So this recreates production's exact bodies in a transaction, runs the same
-- transformation, then CALLS each one with no base URL configured and asserts
-- it no-ops silently. Everything rolls back.
BEGIN;

SET LOCAL check_function_bodies = on;   -- syntax errors surface at CREATE, not at 3am

-- ── production's bodies, verbatim ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk_trg_dispatch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
DECLARE
  v_url     TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
  v_payload JSONB;
  v_secret  TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'process_notification_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

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
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$body$;

CREATE OR REPLACE FUNCTION public.chk_sweep_events()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
DECLARE
  v_event  RECORD;
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'process_notification_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

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
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_secret, '')
      ),
      timeout_milliseconds := 5000
    );
  END LOOP;
END;
$body$;

-- The one that does real DB work BEFORE it posts. An early-return guard would
-- have silently stopped expiring the bin; this asserts it does not.
CREATE TABLE IF NOT EXISTS public.chk_bin_marker(n INT);

CREATE OR REPLACE FUNCTION public.chk_purge_bin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/purge-filehub-bin';
  v_secret TEXT := '';
BEGIN
  INSERT INTO public.chk_bin_marker(n) VALUES (1);   -- stands in for the DELETE

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
$body$;

-- ── the transformation, character-for-character as the migration runs it ────
DO $patch$
DECLARE
  v_name TEXT;
  v_def  TEXT;
  v_new  TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['chk_trg_dispatch','chk_sweep_events','chk_purge_bin'] LOOP
    SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc WHERE proname = v_name AND pronamespace = 'public'::regnamespace;

    v_new := regexp_replace(
      v_def,
      '''https://[a-z0-9]+\.supabase\.co(/functions/v1/)',
      'public.fn_edge_base_url() || ''\1',
      'g'
    );

    IF position('PERFORM net.http_post(' IN v_new) = 0
       OR v_new !~ 'timeout_milliseconds := \d+\s*\);' THEN
      RAISE EXCEPTION 'anchor missing in %', v_name;
    END IF;

    v_new := replace(v_new, 'PERFORM net.http_post(', 'IF v_url IS NOT NULL THEN PERFORM net.http_post(');
    v_new := regexp_replace(v_new, '(timeout_milliseconds := \d+\s*\);)', '\1 END IF;', 'g');

    EXECUTE v_new;   -- check_function_bodies=on: a botched guard fails HERE
  END LOOP;
  RAISE NOTICE 'OK (1): all three prod-shaped bodies re-created after patching — the rewrite compiles';
END
$patch$;

-- ── they must be inert, and still do their own work ─────────────────────────
DO $behaviour$
DECLARE
  v_before INT;
  v_after  INT;
  v_rows   INT;
BEGIN
  IF public.fn_edge_base_url() IS NOT NULL THEN
    RAISE EXCEPTION 'this database HAS a base url configured — the no-op assertions below would be meaningless';
  END IF;

  -- The plain function: calling it must not raise (a NULL url handed to
  -- net.http_post raises, which is the whole reason for the guard).
  PERFORM public.chk_sweep_events();

  -- The one with real work before the POST: the work must still happen.
  SELECT count(*) INTO v_before FROM public.chk_bin_marker;
  PERFORM public.chk_purge_bin();
  SELECT count(*) INTO v_after FROM public.chk_bin_marker;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'the guard swallowed the function''s own DB work: % -> %', v_before, v_after;
  END IF;

  -- The trigger: must still RETURN NEW, so the INSERT lands.
  CREATE TEMP TABLE chk_trg_target(id serial PRIMARY KEY, v TEXT) ON COMMIT DROP;
  CREATE TRIGGER chk_t BEFORE INSERT ON chk_trg_target
    FOR EACH ROW EXECUTE FUNCTION public.chk_trg_dispatch();
  INSERT INTO chk_trg_target(v) VALUES ('x');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 OR NOT EXISTS (SELECT 1 FROM chk_trg_target WHERE v = 'x') THEN
    RAISE EXCEPTION 'the rewritten TRIGGER dropped its row — RETURN NEW was lost';
  END IF;

  RAISE NOTICE 'OK (2): dispatch no-ops with no base url, the bin''s own work still runs, the trigger still returns NEW';
END
$behaviour$;

-- ── and nothing kept a hardcoded host ───────────────────────────────────────
DO $final$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(proname, ', ') INTO v_bad
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname LIKE 'chk\_%'
    AND prosrc ~ 'https://[a-z0-9]+\.supabase\.co/functions/v1/';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'still hardcoded after patch: %', v_bad;
  END IF;
  RAISE NOTICE 'OK (3): no hardcoded functions host survives the rewrite';
  RAISE NOTICE 'ALL OK: the #169 rewrite is safe against production''s real bodies — trigger, loop and pre-POST work all intact.';
END
$final$;

ROLLBACK;
