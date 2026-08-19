-- Runnable check for issue #284, Phase 1: harvest_rules / harvested_files
-- schema + pointer core (20260819_harvest_rules_schema.sql).
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_harvest_rules_schema.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates two throwaway companies (own
-- users/pipelines/stages/folders/files), always rolls back, safe to re-run.
-- Exercises real RLS via `SET LOCAL ROLE authenticated` +
-- set_config('request.jwt.claim.sub', <uid>, true), same convention as
-- check_project_deliverable.sql.
--
-- What it proves:
--   1. Both tables + all new columns/constraints exist with the right shape.
--   2. condition_type CHECK rejects anything but 'stage_entry'.
--   3. harvested_files' one-of(source_task_id, source_project_id) CHECK
--      rejects both-null and both-populated.
--   4. UNIQUE (destination_folder_id, source_file_version_id) blocks a
--      duplicate insert.
--   5. RLS: a same-company user (folder-accessible) can SELECT the
--      harvested_files row; a different-company user cannot.
--   6. fn_ensure_harvest_destination_folder: lazy create on first call,
--      idempotent on a second call, and -- the key regression guard -- does
--      NOT blindly return a cached folder id once that folder is
--      soft-deleted; it creates and repoints to a fresh replacement.

BEGIN;

CREATE TEMP TABLE hrs_check_ctx (
  company_a   UUID,
  company_b   UUID,
  user_a      UUID,  -- company A, sees the harvested_files row
  user_b      UUID,  -- company B, must NOT see it
  pipeline_a  UUID,
  stage_a     UUID,
  rule_a      UUID,
  dest_folder UUID,
  file_a      UUID,
  version_a   UUID,
  project_a   UUID,  -- real FK target for source_project_id fixtures
  task_a      UUID,  -- real FK target for source_task_id fixtures
  tag         TEXT
);
GRANT SELECT, INSERT, UPDATE ON hrs_check_ctx TO authenticated;

-- ── Fixture setup (runs as postgres -- bypasses RLS) ────────────────────────
DO $$
DECLARE
  v_tag        TEXT := replace(gen_random_uuid()::text, '-', '');
  v_company_a  UUID;
  v_company_b  UUID;
  v_user_a     UUID := gen_random_uuid();
  v_user_b     UUID := gen_random_uuid();
  v_pipeline_a UUID;
  v_stage_a    UUID;
  v_rule_a     UUID;
  v_folder_a   UUID;
  v_file_a     UUID;
  v_version_a  UUID;
  v_project_a  UUID;
  v_task_a     UUID;
BEGIN
  INSERT INTO public.companies (name, slug) VALUES ('HRS Selfcheck Co A ' || v_tag, 'hrs-selfcheck-a-' || v_tag)
    RETURNING id INTO v_company_a;
  INSERT INTO public.companies (name, slug) VALUES ('HRS Selfcheck Co B ' || v_tag, 'hrs-selfcheck-b-' || v_tag)
    RETURNING id INTO v_company_b;

  INSERT INTO auth.users (id, email) VALUES (v_user_a, 'hrs-a-' || v_tag || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner) VALUES (v_user_a, v_company_a, 'hrs-a-' || v_tag || '@test.local', true);

  INSERT INTO auth.users (id, email) VALUES (v_user_b, 'hrs-b-' || v_tag || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner) VALUES (v_user_b, v_company_b, 'hrs-b-' || v_tag || '@test.local', true);

  INSERT INTO public.pipelines (company_id, name, subject_kind, created_by)
  VALUES (v_company_a, 'HRS Selfcheck Pipeline ' || v_tag, 'task', v_user_a)
  RETURNING id INTO v_pipeline_a;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline_a, 'HRS Selfcheck Stage ' || v_tag, 1, true)
  RETURNING id INTO v_stage_a;

  INSERT INTO public.harvest_rules (company_id, pipeline_id, source_stage_id, condition_type, created_by)
  VALUES (v_company_a, v_pipeline_a, v_stage_a, 'stage_entry', v_user_a)
  RETURNING id INTO v_rule_a;

  INSERT INTO public.filehub_folders (company_id, name, created_by, scope)
  VALUES (v_company_a, 'HRS Selfcheck Dest ' || v_tag, v_user_a, 'broadcast')
  RETURNING id INTO v_folder_a;

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, size_bytes, visibility, folder_id)
  VALUES (v_company_a, v_user_a, 'selfcheck/hrs/' || v_tag || '/src.txt', 'filehub-files', 'src.txt', 10, 'broadcast', v_folder_a)
  RETURNING id INTO v_file_a;

  INSERT INTO public.filehub_file_versions (file_id, company_id, version_no, storage_path, original_name, size_bytes, created_by)
  VALUES (v_file_a, v_company_a, 1, 'selfcheck/hrs/' || v_tag || '/src.txt', 'src.txt', 10, v_user_a)
  RETURNING id INTO v_version_a;

  -- Real FK targets (not gen_random_uuid() placeholders) so the one-of/UNIQUE
  -- checks below fail for the reason under test, not an incidental FK miss.
  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company_a, 'HRS Selfcheck Project ' || v_tag, v_user_a)
  RETURNING id INTO v_project_a;

  INSERT INTO public.tasks (company_id, title, created_by)
  VALUES (v_company_a, 'HRS Selfcheck Task ' || v_tag, v_user_a)
  RETURNING id INTO v_task_a;

  INSERT INTO hrs_check_ctx (company_a, company_b, user_a, user_b, pipeline_a, stage_a, rule_a, dest_folder, file_a, version_a, project_a, task_a, tag)
  VALUES (v_company_a, v_company_b, v_user_a, v_user_b, v_pipeline_a, v_stage_a, v_rule_a, v_folder_a, v_file_a, v_version_a, v_project_a, v_task_a, v_tag);
END $$;

-- ── 1. Shape: tables, columns, constraints exist ────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.harvest_rules') IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): harvest_rules table missing';
  END IF;
  IF to_regclass('public.harvested_files') IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): harvested_files table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'harvest_rules'
      AND column_name IN ('pipeline_id','source_stage_id','condition_type','condition_params',
                           'destination_folder_id','is_active','priority','check_interval_minutes',
                           'last_run_at','created_by','company_id')
    HAVING COUNT(*) = 11
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): harvest_rules is missing one or more required columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'harvested_files'
      AND column_name IN ('harvest_rule_id','source_file_version_id','destination_folder_id',
                           'source_task_id','source_project_id','company_id','harvested_by','harvested_at')
    HAVING COUNT(*) = 8
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (1d): harvested_files is missing one or more required columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'automation_execution_log' AND column_name = 'harvest_rule_id'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (1e): automation_execution_log.harvest_rule_id missing';
  END IF;

  -- FK ON DELETE behaviour: source_file_version_id/destination_folder_id must be RESTRICT.
  IF (
    SELECT confdeltype FROM pg_constraint
    WHERE conrelid = 'public.harvested_files'::regclass AND conname LIKE '%source_file_version_id%'
  ) <> 'r' THEN
    RAISE EXCEPTION 'CHECK FAILED (1f): harvested_files.source_file_version_id FK must be ON DELETE RESTRICT';
  END IF;
  IF (
    SELECT confdeltype FROM pg_constraint
    WHERE conrelid = 'public.harvested_files'::regclass AND conname LIKE '%destination_folder_id%'
  ) <> 'r' THEN
    RAISE EXCEPTION 'CHECK FAILED (1g): harvested_files.destination_folder_id FK must be ON DELETE RESTRICT';
  END IF;

  RAISE NOTICE 'OK (1): both tables, required columns, and RESTRICT FKs are in place.';
END $$;

-- ── 2. condition_type CHECK rejects anything outside the allowlist ─────────
-- As of issue #284 Phase 3 (20260821_harvest_rule_configurability.sql), the
-- allowlist widened to ('stage_entry', 'stage_terminal_success') --
-- 'stage_terminal_success' is now a legal value (exercised separately in
-- check_harvest_rules_rpc.sql), so this check now proves the CHECK still
-- rejects 'field_equals' -- the plan's Phase 0 decision was that value
-- stays a nonexistent, unimplemented condition, never a real allowed one.
DO $$
DECLARE
  c        RECORD;
  v_raised BOOLEAN := false;
  v_msg    TEXT;
BEGIN
  SELECT * INTO c FROM hrs_check_ctx;
  BEGIN
    INSERT INTO public.harvest_rules (company_id, pipeline_id, source_stage_id, condition_type, created_by)
    VALUES (c.company_a, c.pipeline_a, c.stage_a, 'field_equals', c.user_a);
    v_raised := true;
  EXCEPTION WHEN check_violation THEN
    v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (2): condition_type accepted ''field_equals'' -- it must stay unimplemented, not a real allowed value';
  END IF;
  RAISE NOTICE 'OK (2): condition_type CHECK correctly rejected ''field_equals'' (%).', v_msg;
END $$;

-- ── 3. harvested_files one-of(source_task_id, source_project_id) CHECK ─────
DO $$
DECLARE
  c        RECORD;
  v_raised BOOLEAN;
BEGIN
  SELECT * INTO c FROM hrs_check_ctx;

  -- both NULL
  v_raised := false;
  BEGIN
    INSERT INTO public.harvested_files (harvest_rule_id, source_file_version_id, destination_folder_id, company_id, harvested_by)
    VALUES (c.rule_a, c.version_a, c.dest_folder, c.company_a, c.user_a);
    v_raised := true;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (3a): insert with both source_task_id/source_project_id NULL was accepted';
  END IF;

  -- both populated (real FK targets, so a rejection can only be the CHECK)
  v_raised := false;
  BEGIN
    INSERT INTO public.harvested_files (harvest_rule_id, source_file_version_id, destination_folder_id, source_task_id, source_project_id, company_id, harvested_by)
    VALUES (c.rule_a, c.version_a, c.dest_folder, c.task_a, c.project_a, c.company_a, c.user_a);
    v_raised := true;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (3b): insert with BOTH source_task_id and source_project_id populated was accepted';
  END IF;

  RAISE NOTICE 'OK (3): the one-of(source_task_id, source_project_id) CHECK rejects both-null and both-populated.';
END $$;

-- ── 4. UNIQUE (destination_folder_id, source_file_version_id) ──────────────
DO $$
DECLARE
  c          RECORD;
  v_first    UUID;
  v_raised   BOOLEAN := false;
BEGIN
  SELECT * INTO c FROM hrs_check_ctx;

  INSERT INTO public.harvested_files (harvest_rule_id, source_file_version_id, destination_folder_id, source_task_id, company_id, harvested_by)
  VALUES (c.rule_a, c.version_a, c.dest_folder, c.task_a, c.company_a, c.user_a)
  RETURNING id INTO v_first;

  BEGIN
    INSERT INTO public.harvested_files (harvest_rule_id, source_file_version_id, destination_folder_id, source_task_id, company_id, harvested_by)
    VALUES (c.rule_a, c.version_a, c.dest_folder, c.task_a, c.company_a, c.user_a);
    v_raised := true;
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (4): a duplicate (destination_folder_id, source_file_version_id) insert was accepted';
  END IF;

  RAISE NOTICE 'OK (4): UNIQUE (destination_folder_id, source_file_version_id) blocks a duplicate insert (row % kept).', v_first;
END $$;

-- ── 5. RLS: same-company (folder-accessible) sees it, other company doesn't ─
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c    RECORD;
  v_ok BOOLEAN;
BEGIN
  SELECT * INTO c FROM hrs_check_ctx;

  PERFORM set_config('request.jwt.claim.sub', c.user_a::text, true);
  SELECT EXISTS(SELECT 1 FROM public.harvested_files WHERE destination_folder_id = c.dest_folder) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5a): company-A user cannot see the harvested_files row via RLS';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', c.user_b::text, true);
  SELECT EXISTS(SELECT 1 FROM public.harvested_files WHERE destination_folder_id = c.dest_folder) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): company-B user CAN see a company-A harvested_files row -- RLS is leaking across companies';
  END IF;

  RAISE NOTICE 'OK (5): RLS follows destination-folder + company_id -- same-company sees it, cross-company does not.';
END $$;

RESET ROLE;

-- ── 6. fn_ensure_harvest_destination_folder: lazy, idempotent, soft-delete-safe ─
DO $$
DECLARE
  c           RECORD;
  v_folder1   UUID;
  v_folder2   UUID;
  v_folder3   UUID;
  v_cached_id UUID;
BEGIN
  SELECT * INTO c FROM hrs_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.user_a::text, true);

  -- rule_a starts with destination_folder_id IS NULL.
  IF EXISTS (SELECT 1 FROM public.harvest_rules WHERE id = c.rule_a AND destination_folder_id IS NOT NULL) THEN
    RAISE EXCEPTION 'CHECK FAILED (6 setup): rule_a already has a destination_folder_id -- fixture invalid for this check';
  END IF;

  SELECT public.fn_ensure_harvest_destination_folder(c.rule_a) INTO v_folder1;
  IF v_folder1 IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (6a): fn_ensure_harvest_destination_folder returned NULL on first call';
  END IF;
  SELECT destination_folder_id INTO v_cached_id FROM public.harvest_rules WHERE id = c.rule_a;
  IF v_cached_id IS DISTINCT FROM v_folder1 THEN
    RAISE EXCEPTION 'CHECK FAILED (6b): harvest_rules.destination_folder_id was not persisted after lazy create';
  END IF;

  -- Second call: idempotent, same folder, no second row created.
  SELECT public.fn_ensure_harvest_destination_folder(c.rule_a) INTO v_folder2;
  IF v_folder2 IS DISTINCT FROM v_folder1 THEN
    RAISE EXCEPTION 'CHECK FAILED (6c): fn_ensure_harvest_destination_folder is not idempotent: % vs %', v_folder1, v_folder2;
  END IF;

  -- Soft-delete the cached folder -- the regression guard fn_project_ensure_
  -- deliverable_folder does NOT have: a dead cached id must not be returned.
  UPDATE public.filehub_folders SET deleted_at = now() WHERE id = v_folder1;

  SELECT public.fn_ensure_harvest_destination_folder(c.rule_a) INTO v_folder3;
  IF v_folder3 IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (6d): fn_ensure_harvest_destination_folder returned NULL after the cached folder was soft-deleted';
  END IF;
  IF v_folder3 = v_folder1 THEN
    RAISE EXCEPTION 'CHECK FAILED (6e): fn_ensure_harvest_destination_folder blindly returned the soft-deleted folder id % -- same bug as fn_project_ensure_deliverable_folder', v_folder1;
  END IF;
  IF EXISTS (SELECT 1 FROM public.filehub_folders WHERE id = v_folder3 AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'CHECK FAILED (6f): the replacement folder % is itself soft-deleted', v_folder3;
  END IF;
  SELECT destination_folder_id INTO v_cached_id FROM public.harvest_rules WHERE id = c.rule_a;
  IF v_cached_id IS DISTINCT FROM v_folder3 THEN
    RAISE EXCEPTION 'CHECK FAILED (6g): harvest_rules.destination_folder_id was not repointed to the replacement folder';
  END IF;

  RAISE NOTICE 'OK (6): lazy create (%), idempotent second call, and a soft-deleted cached folder correctly triggers a fresh replacement (%) rather than being trusted blindly.', v_folder1, v_folder3;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL CHECKS PASSED: harvest_rules/harvested_files schema, RLS, one-of/unique constraints, and fn_ensure_harvest_destination_folder''s soft-delete guard all behave as designed (issue #284 Phase 1).';
END $$;

ROLLBACK;
