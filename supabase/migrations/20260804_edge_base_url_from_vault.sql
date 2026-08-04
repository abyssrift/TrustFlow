-- #169: a database clone can only ever call PRODUCTION.
--
-- Five DB->edge invokers embed the production functions URL as a literal:
--
--   v_url TEXT := 'https://<prod-ref>.supabase.co/functions/v1/<name>';
--
-- There is no indirection, so ANY copy of this database — a local
-- `supabase start`, a branch database, a restored backup someone is poking at
-- — points its cron jobs and its triggers at production. That is not
-- hypothetical: on 2026-07-30 a local stack delivered 96 duplicate
-- notifications to a real user over three hours, using real production task
-- UUIDs, and only stopped when Docker was quit. `markProcessed` then wrote
-- back to PROD by an id that existed only locally, matched zero rows, and the
-- local rows were replayed every five minutes forever.
--
-- The remediation so far has been two guards that both live outside the
-- schema: `seed.sql` unschedules cron after a clone, and the local database
-- has had these five bodies neutered BY HAND. Neither survives re-applying
-- migrations, and the hand-neutering is invisible drift that no check can see.
--
-- This makes the rule structural instead. The base URL comes from a vault
-- secret. Absent secret -> `v_url` is NULL -> the POST is skipped. A clone is
-- therefore inert BY DEFAULT and has to be deliberately told it is allowed to
-- dispatch; the literal can no longer smuggle production into a copy.
--
-- WHY NOT SEED THE SECRET FROM THE LITERAL WE ARE REMOVING: a fresh clone
-- applies these same migrations, so it would extract the same production URL
-- and configure itself to call production — exactly the bug, reintroduced by
-- its own fix. The value MUST come from outside the schema. See the WARNING at
-- the bottom: production needs one deliberate step after this migration, and
-- the migration says so out loud rather than failing quietly at 3am.

-- ── the indirection ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_edge_base_url()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base TEXT;
BEGIN
  -- Same defensive read the invokers already use for their shared secrets:
  -- on a database where the vault extension is absent this must return NULL,
  -- not raise, or a missing extension would break every notification INSERT.
  BEGIN
    SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets
    WHERE name = 'edge_functions_base_url'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  v_base := nullif(btrim(COALESCE(v_base, '')), '');
  IF v_base IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN rtrim(v_base, '/');   -- callers append '/functions/v1/...'
END;
$$;

REVOKE ALL ON FUNCTION public.fn_edge_base_url() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_edge_base_url() IS
  'Base URL for DB->Edge dispatch, from the vault secret `edge_functions_base_url`. NULL means "this database may not dispatch" — which is the correct default for every clone.';

-- ── patch the five invokers ─────────────────────────────────────────────────
-- Patched from each LIVE body via pg_get_functiondef, never retyped: two
-- migrations in this repo have silently dropped behaviour by recreating a
-- function from a remembered body (see the notes on
-- rpc_filehub_group_list_files). All five share one shape, so one anchored
-- transformation covers them:
--
--   1. the literal base becomes public.fn_edge_base_url(), so v_url is NULL
--      when unconfigured;
--   2. the POST is wrapped in `IF v_url IS NOT NULL THEN ... END IF;`.
--
-- (2) is why this is not simply an early RETURN at the top of each function:
-- fn_invoke_purge_filehub_bin does a real DELETE of expired folders BEFORE it
-- posts, and that work must still happen. Guarding the POST alone keeps every
-- body's own behaviour intact.
DO $patch$
DECLARE
  v_name    TEXT;
  v_def     TEXT;
  v_new     TEXT;
  v_patched INT := 0;
  v_skipped INT := 0;
  v_names   TEXT[] := ARRAY[
    'fn_trg_dispatch_notification_event',
    'fn_sweep_pending_notification_events',
    'fn_invoke_purge_filehub_versions',
    'fn_invoke_purge_filehub_bin',
    'fn_invoke_filehub_orphan_sweep',
    -- #169 names five. This is a sixth with the identical shape, found by
    -- grepping for the pattern rather than trusting the list: a clone pointing
    -- at production's BILLING renewal endpoint is the worst of the set, not an
    -- out-of-scope extra.
    'fn_invoke_billing_paymob_renew'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
    WHERE proname = v_name AND pronamespace = 'public'::regnamespace;

    IF v_def IS NULL THEN
      RAISE NOTICE 'skip %: not present in this database', v_name;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF position('fn_edge_base_url' IN v_def) > 0 THEN
      RAISE NOTICE 'skip %: already reads the vault base url', v_name;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- A body with no hardcoded host is either already fixed or locally
    -- neutered. Either way there is nothing to rewrite and nothing to warn
    -- about — but say which, so the local hand-patching stops being invisible.
    IF position('.supabase.co/functions/v1/' IN v_def) = 0 THEN
      RAISE NOTICE 'skip %: no hardcoded functions host in this body (neutered or already indirect)', v_name;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- 1. host literal -> helper call. Matches ANY project ref, so a database
    --    that was cloned from a different project is fixed too.
    v_new := regexp_replace(
      v_def,
      '''https://[a-z0-9]+\.supabase\.co(/functions/v1/)',
      'public.fn_edge_base_url() || ''\1',
      'g'
    );

    -- 2. guard the POST, and close the guard after the call's own `);`.
    IF position('PERFORM net.http_post(' IN v_new) = 0
       OR v_new !~ 'timeout_milliseconds := \d+\s*\);' THEN
      RAISE EXCEPTION 'could not locate the http_post call in % — refusing to patch blindly', v_name;
    END IF;

    v_new := replace(v_new, 'PERFORM net.http_post(', 'IF v_url IS NOT NULL THEN PERFORM net.http_post(');
    v_new := regexp_replace(v_new, '(timeout_milliseconds := \d+\s*\);)', '\1 END IF;', 'g');

    EXECUTE v_new;
    v_patched := v_patched + 1;
    RAISE NOTICE 'patched %', v_name;
  END LOOP;

  RAISE NOTICE 'edge base url: % patched, % skipped', v_patched, v_skipped;
END
$patch$;

-- ── verify ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_bad     TEXT;
  v_unguard TEXT;
BEGIN
  -- Nothing anywhere may still hardcode a functions host.
  SELECT string_agg(proname, ', ') INTO v_bad
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND prosrc ~ 'https://[a-z0-9]+\.supabase\.co/functions/v1/';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'these functions still hardcode a functions host: %', v_bad;
  END IF;

  -- Every remaining POST must be behind the NULL guard, or a clone still calls out.
  SELECT string_agg(proname, ', ') INTO v_unguard
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND prosrc LIKE '%net.http_post%'
    AND prosrc NOT LIKE '%IF v_url IS NOT NULL THEN%';

  IF v_unguard IS NOT NULL THEN
    RAISE EXCEPTION 'these functions POST without a base-url guard: %', v_unguard;
  END IF;

  RAISE NOTICE 'verify: no hardcoded functions host remains, and every dispatch is guarded';
END
$verify$;

-- ── the one deliberate step production needs ────────────────────────────────
DO $notice$
BEGIN
  IF public.fn_edge_base_url() IS NULL THEN
    RAISE WARNING E'\n'
      '================================================================\n'
      'DB->Edge dispatch is now DISABLED in this database.\n'
      'That is correct for a local stack, a branch db or a restored backup.\n'
      '\n'
      'On PRODUCTION ONLY, enable it with:\n'
      '\n'
      '  SELECT vault.create_secret(\n'
      '    ''https://<project-ref>.supabase.co'',\n'
      '    ''edge_functions_base_url'',\n'
      '    ''Base URL for DB->Edge dispatch (#169)''\n'
      '  );\n'
      '\n'
      'Until then: no notification dispatch, no bin/version purge calls,\n'
      'no orphan sweep. The DELETE inside purge_filehub_bin still runs.\n'
      '================================================================';
  ELSE
    RAISE NOTICE 'DB->Edge dispatch is enabled; base url is configured in vault';
  END IF;
END
$notice$;
