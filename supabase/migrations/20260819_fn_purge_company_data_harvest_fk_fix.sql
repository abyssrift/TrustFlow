-- 20260819_fn_purge_company_data_harvest_fk_fix.sql
-- #284 Phase 1 close-out: 20260819_harvest_rules_schema.sql added
-- harvested_files.source_file_version_id REFERENCES filehub_file_versions(id)
-- ON DELETE RESTRICT (deliberate -- a harvested pointer must never silently
-- lose its source version). purge-filehub-bin/index.ts and
-- purge-filehub-versions/index.ts were updated to exclude referenced
-- versions from their batch deletes, but fn_purge_company_data() -- the one
-- shared body behind rpc_purge_company/rpc_platform_delete_company
-- (20260816_company_purge_unification.sql) -- was not touched: it didn't
-- exist yet when that migration was written. It already unconditionally
-- deletes filehub_file_versions (a NO ACTION FK table) as step (c). Any
-- company with a harvested_files row pointing at one of its own file
-- versions now hits the RESTRICT and the whole purge transaction fails.
--
-- Fix: delete harvested_files and harvest_rules (both company-scoped, both
-- otherwise only CASCADE off companies at step (e), i.e. too late) before
-- the filehub_file_versions delete, same as every other entry in that list
-- being ordered to satisfy FK dependencies. harvest_rules has no RESTRICT
-- dependency of its own, but it's a company-scoped table with the same
-- shape gap the surrounding NO-ACTION-FK list already exists to close, so
-- it's added alongside harvested_files rather than left to CASCADE.
--
-- Body below is CREATE OR REPLACE'd from the LIVE definition (pg_get_
-- functiondef against local docker postgres, confirmed identical to
-- 20260816_company_purge_unification.sql's text before editing) with only
-- the two new DELETE lines inserted -- not retyped from the migration file
-- by hand (see MEMORY.md: group_list_files payload key regressions --
-- retyping a stale body from a file rather than the live definition has
-- caused real regressions in this repo before).
CREATE OR REPLACE FUNCTION public.fn_purge_company_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name    text;
  v_stopped int;
BEGIN
  SELECT name INTO v_name FROM public.companies WHERE id = p_company_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  -- (a) Null self-referential FKs before anything downstream touches them —
  -- a manager hierarchy or nested team structure otherwise leaves dangling
  -- reports_to/manager_id/parent_team_id pointers mid-purge.
  UPDATE public.users
  SET reports_to = NULL
  WHERE company_id = p_company_id AND reports_to IS NOT NULL;

  UPDATE public.teams
  SET manager_id = NULL
  WHERE company_id = p_company_id AND manager_id IS NOT NULL;

  UPDATE public.teams
  SET parent_team_id = NULL
  WHERE company_id = p_company_id AND parent_team_id IS NOT NULL;

  -- (b) Stop any running timers gracefully (same pattern as #161's
  -- rpc_remove_user_from_company, scoped to the whole company here).
  WITH stopped AS (
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = COALESCE(last_heartbeat_at, now()),
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (
            COALESCE(last_heartbeat_at, now()) - started_at))::int)
    WHERE company_id = p_company_id AND status = 'active'
    RETURNING id
  )
  SELECT count(*) INTO v_stopped FROM stopped;

  -- (c) The 11 tables with a NO ACTION/RESTRICT FK to companies(id) (or, for
  -- harvested_files, a RESTRICT FK to a table also purged here) — every
  -- other FK'd table CASCADEs on its own. harvested_files and harvest_rules
  -- must go BEFORE filehub_file_versions: harvested_files.source_file_
  -- version_id is ON DELETE RESTRICT (#284, 20260819_harvest_rules_
  -- schema.sql) — deleting filehub_file_versions first would fail with a
  -- foreign-key violation on any company with a harvested pointer.
  DELETE FROM public.task_comments         WHERE company_id = p_company_id;
  DELETE FROM public.task_work_sessions     WHERE company_id = p_company_id;
  DELETE FROM public.team_members           WHERE company_id = p_company_id;
  DELETE FROM public.team_roles             WHERE company_id = p_company_id;
  DELETE FROM public.user_roles             WHERE company_id = p_company_id;
  DELETE FROM public.pipeline_stage_targets WHERE company_id = p_company_id;
  DELETE FROM public.storage_archive_queue  WHERE company_id = p_company_id;
  DELETE FROM public.harvested_files        WHERE company_id = p_company_id;
  DELETE FROM public.harvest_rules          WHERE company_id = p_company_id;
  DELETE FROM public.filehub_file_versions  WHERE company_id = p_company_id;
  DELETE FROM public.archives               WHERE company_id = p_company_id;

  -- (d) These 3 have a company_id column but no FK at all — previously
  -- silently orphaned by both RPCs. files_index is a VIEW (over
  -- filehub_files/submission_attachments/task_attachments), not a table —
  -- it must NOT get a delete here, it would error.
  DELETE FROM public.task_manual_time_entries WHERE company_id = p_company_id;
  DELETE FROM public.task_attachment_versions WHERE company_id = p_company_id;
  DELETE FROM public.task_submission_versions WHERE company_id = p_company_id;

  -- (e) Everything else FK'd to companies(id) CASCADEs from here.
  DELETE FROM public.companies WHERE id = p_company_id;

  RETURN jsonb_build_object(
    'purged_company', p_company_id,
    'name', v_name,
    'sessions_stopped', v_stopped,
    'purged_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_purge_company_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_company_data(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- Overload guard — CREATE OR REPLACE with a changed argument list ADDS a
-- signature rather than replacing. Fail the migration rather than discover
-- it in the editor.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN ('fn_purge_company_data')
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
