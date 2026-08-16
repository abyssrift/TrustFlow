-- #192 regression check: rpc_purge_company (owner self-service) and
-- rpc_platform_delete_company (platform-admin) both route through the new
-- shared fn_purge_company_data() now. Before the fix:
--   - rpc_purge_company crashed on a company with a manager hierarchy or
--     nested teams (self-ref FKs never nulled).
--   - rpc_platform_delete_company crashed on a company with FileHub version
--     history (filehub_file_versions, a NO ACTION FK, was never deleted).
--   - BOTH silently orphaned task_manual_time_entries,
--     task_attachment_versions, task_submission_versions (no FK to
--     companies at all, so nothing ever caught it).
-- Also covers the new rpc_platform_soft_delete_company /
-- rpc_platform_restore_company grace-period pair.
--
-- Run:  MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
--         psql -U postgres -d postgres -f - < supabase/checks/check_company_purge.sql
-- BEGIN/ROLLBACK, safe to re-run, changes nothing (fixtures + helper
-- functions all roll back with everything else).
BEGIN;

-- Throwaway fixture builder: one full company with a row in every table the
-- purge has to touch — self-ref FKs (reports_to, manager_id, parent_team_id
-- self-referential), all 9 NO ACTION-FK tables that matter for a fresh
-- company (task_work_sessions, filehub_file_versions), and the 3 no-FK
-- tables (task_manual_time_entries, task_attachment_versions,
-- task_submission_versions).
CREATE FUNCTION public._zz_mk_purge_fixture(
  p_tag text,
  OUT v_company uuid, OUT v_owner uuid, OUT v_second uuid, OUT v_name text
)
RETURNS record
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_team     uuid := gen_random_uuid();
  v_pipeline uuid;
  v_stage    uuid;
  v_task     uuid;
  v_attach   uuid;
  v_submit   uuid;
  v_file     uuid;
BEGIN
  -- Clear any JWT claim left set by a previous case's impersonation — this
  -- function always runs as the postgres superuser, but auth.uid() reads
  -- straight off the session GUC regardless of role, and a stale claim
  -- pointing at a non-existent/wrong-scope user trips FK-checked triggers
  -- like _rate_limit_pipeline_create's rate_limit_buckets insert.
  PERFORM set_config('request.jwt.claims', '', true);

  v_owner  := gen_random_uuid();
  v_second := gen_random_uuid();
  v_name   := 'ZZ Purge ' || p_tag || ' ' || substr(v_owner::text, 1, 8);

  INSERT INTO public.companies (name, slug) VALUES (v_name, lower(replace(v_name, ' ', '-')))
    RETURNING id INTO v_company;

  INSERT INTO auth.users (id, email) VALUES (v_owner, 'zz-owner-' || v_owner || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner)
    VALUES (v_owner, v_company, 'zz-owner-' || v_owner || '@test.local', true);

  INSERT INTO auth.users (id, email) VALUES (v_second, 'zz-second-' || v_second || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner, reports_to)
    VALUES (v_second, v_company, 'zz-second-' || v_second || '@test.local', false, v_owner);

  -- Self-referential team: manager_id -> owner, parent_team_id -> itself.
  INSERT INTO public.teams (id, company_id, name, manager_id, parent_team_id)
    VALUES (v_team, v_company, 'ZZ Team', v_owner, v_team);

  INSERT INTO public.pipelines (company_id, name, created_by)
    VALUES (v_company, 'ZZ Pipeline', v_owner) RETURNING id INTO v_pipeline;
  INSERT INTO public.pipeline_stages (pipeline_id, name, "position", submission_mode)
    VALUES (v_pipeline, 'ZZ Stage', 1, 'none') RETURNING id INTO v_stage;

  INSERT INTO public.tasks (company_id, title, created_by)
    VALUES (v_company, 'ZZ Task', v_owner) RETURNING id INTO v_task;

  INSERT INTO public.task_attachments (task_id, company_id, uploaded_by, file_name, file_url)
    VALUES (v_task, v_company, v_owner, 'zz.txt', 'https://example.test/zz.txt')
    RETURNING id INTO v_attach;
  INSERT INTO public.task_attachment_versions (attachment_id, company_id, version_no, created_by)
    VALUES (v_attach, v_company, 1, v_owner);

  INSERT INTO public.task_submissions (task_id, company_id, submitted_by)
    VALUES (v_task, v_company, v_owner) RETURNING id INTO v_submit;
  INSERT INTO public.task_submission_versions (submission_id, company_id, version_no, created_by)
    VALUES (v_submit, v_company, 1, v_owner);

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, original_name, size_bytes, visibility)
    VALUES (v_company, v_owner, 'zz/path.txt', 'zz.txt', 10, 'direct') RETURNING id INTO v_file;
  INSERT INTO public.filehub_file_versions
      (file_id, company_id, version_no, storage_path, original_name, size_bytes, created_by)
    VALUES (v_file, v_company, 1, 'zz/path.txt', 'zz.txt', 10, v_owner);

  INSERT INTO public.task_work_sessions (task_id, user_id, company_id, status)
    VALUES (v_task, v_owner, v_company, 'active');

  INSERT INTO public.task_manual_time_entries (task_id, stage_id, user_id, company_id, declared_minutes)
    VALUES (v_task, v_stage, v_owner, v_company, 30);
END;
$fn$;

-- Sum of fixture rows still present for a company across every table the
-- purge must clear (0 only once everything is gone).
CREATE FUNCTION public._zz_purge_leftovers(p_company uuid) RETURNS bigint
LANGUAGE sql AS $fn$
  SELECT
    (SELECT count(*) FROM public.companies WHERE id = p_company) +
    (SELECT count(*) FROM public.users WHERE company_id = p_company) +
    (SELECT count(*) FROM public.teams WHERE company_id = p_company) +
    (SELECT count(*) FROM public.task_work_sessions WHERE company_id = p_company) +
    (SELECT count(*) FROM public.task_manual_time_entries WHERE company_id = p_company) +
    (SELECT count(*) FROM public.task_attachment_versions WHERE company_id = p_company) +
    (SELECT count(*) FROM public.task_submission_versions WHERE company_id = p_company) +
    (SELECT count(*) FROM public.filehub_file_versions WHERE company_id = p_company)
$fn$;

DO $$
DECLARE
  f          RECORD;
  v_admin_email text;
  v_deleted_at  timestamptz;
  v_is_active   boolean;
  v_session_status text;
  v_task_id     uuid;
BEGIN
  -- ── Case 1: owner self-service purge (rpc_purge_company) ────────────────
  SELECT * INTO f FROM public._zz_mk_purge_fixture('owner');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', f.v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_purge_company(f.v_company, f.v_name);
  RESET ROLE;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id = f.v_company) THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_purge_company did not delete the company row (#192)';
  END IF;
  IF public._zz_purge_leftovers(f.v_company) <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_purge_company left fixture rows behind (#192)';
  END IF;
  RAISE NOTICE 'OK: rpc_purge_company purges self-ref FKs + NO ACTION + no-FK tables cleanly';

  -- ── Case 2: platform-admin purge (rpc_platform_delete_company) —
  -- regression check for the previously-missing filehub_file_versions delete.
  SELECT * INTO f FROM public._zz_mk_purge_fixture('admin');
  v_admin_email := 'zz-admin-' || gen_random_uuid()::text || '@test.local';
  INSERT INTO public.platform_admins (email) VALUES (v_admin_email);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'email', v_admin_email)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_platform_delete_company(f.v_company);
  RESET ROLE;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id = f.v_company) THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_delete_company did not delete the company row (#192)';
  END IF;
  IF public._zz_purge_leftovers(f.v_company) <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_delete_company left fixture rows behind — filehub_file_versions regression? (#192)';
  END IF;
  RAISE NOTICE 'OK: rpc_platform_delete_company purges filehub_file_versions + everything else cleanly';

  -- ── Case 3: rpc_purge_company still rejects a wrong confirm name and a
  -- non-owner caller. ───────────────────────────────────────────────────
  SELECT * INTO f FROM public._zz_mk_purge_fixture('guard');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', f.v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.rpc_purge_company(f.v_company, 'definitely not the workspace name');
    RESET ROLE;
    RAISE EXCEPTION 'CHECK FAILED: rpc_purge_company accepted a wrong confirm name (#192)';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM LIKE 'CHECK FAILED%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', f.v_second::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.rpc_purge_company(f.v_company, f.v_name);
    RESET ROLE;
    RAISE EXCEPTION 'CHECK FAILED: rpc_purge_company let a non-owner purge the company (#192)';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM LIKE 'CHECK FAILED%' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = f.v_company) THEN
    RAISE EXCEPTION 'CHECK FAILED: rejected purge attempts still deleted the company (#192)';
  END IF;
  RAISE NOTICE 'OK: rpc_purge_company rejects wrong confirm name and non-owner callers';

  -- ── Case 4: soft delete / restore grace-period pair ─────────────────────
  SELECT * INTO f FROM public._zz_mk_purge_fixture('soft');
  SELECT task_id INTO v_task_id FROM public.task_work_sessions WHERE company_id = f.v_company LIMIT 1;
  v_admin_email := 'zz-admin-' || gen_random_uuid()::text || '@test.local';
  INSERT INTO public.platform_admins (email) VALUES (v_admin_email);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'email', v_admin_email)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_platform_soft_delete_company(f.v_company);
  RESET ROLE;

  SELECT deleted_at, is_active INTO v_deleted_at, v_is_active FROM public.companies WHERE id = f.v_company;
  IF v_deleted_at IS NULL OR v_is_active <> false THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_soft_delete_company did not set deleted_at/is_active correctly (#192)';
  END IF;

  SELECT status INTO v_session_status FROM public.task_work_sessions WHERE task_id = v_task_id;
  IF v_session_status <> 'completed' THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_soft_delete_company left the active timer running (#192)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = f.v_company) THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_soft_delete_company hard-deleted the company row (#192)';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'email', v_admin_email)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_platform_restore_company(f.v_company);
  RESET ROLE;

  SELECT deleted_at, is_active INTO v_deleted_at, v_is_active FROM public.companies WHERE id = f.v_company;
  IF v_deleted_at IS NOT NULL OR v_is_active <> true THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_restore_company did not clear deleted_at/is_active (#192)';
  END IF;
  RAISE NOTICE 'OK: rpc_platform_soft_delete_company / rpc_platform_restore_company round-trip cleanly';

  -- Both reject a non-platform-admin caller (fixture owner has no
  -- platform_admins row).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', f.v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.rpc_platform_soft_delete_company(f.v_company);
    RESET ROLE;
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_soft_delete_company let a non-platform-admin call it (#192)';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM LIKE 'CHECK FAILED%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', f.v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.rpc_platform_restore_company(f.v_company);
    RESET ROLE;
    RAISE EXCEPTION 'CHECK FAILED: rpc_platform_restore_company let a non-platform-admin call it (#192)';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM LIKE 'CHECK FAILED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK: rpc_platform_soft_delete_company / rpc_platform_restore_company block non-platform-admins';

  RAISE NOTICE 'ALL CHECKS PASSED: #192 company purge unification (fn_purge_company_data, rpc_purge_company, rpc_platform_delete_company, rpc_platform_soft_delete_company, rpc_platform_restore_company)';
END $$;

ROLLBACK;
