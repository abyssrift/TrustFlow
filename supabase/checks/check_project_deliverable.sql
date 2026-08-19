-- Runnable check for issue #284, Phase 2: the harvest mechanism rewritten
-- onto harvest_rules/harvested_files pointers.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_project_deliverable.sql
--
-- Formerly the behavioural-contract check for issue #174's original
-- duplicate-filehub_files-row mechanism. Rewritten here (not just
-- extended) because the underlying mechanism changed shape: harvest_rules
-- rows now drive the trigger (no rpc_create_harvest_rule yet -- Phase 3 --
-- so this check inserts harvest_rules rows directly, same pattern the
-- Phase 1 check (check_harvest_rules_schema.sql) already used) and
-- fn_harvest_task_output writes harvested_files pointer rows, not new
-- filehub_files/filehub_file_versions rows.
--
-- Wrapped in BEGIN/ROLLBACK: creates one throwaway project/task/pipeline
-- stage in an existing seeded company, always rolls back, safe to re-run.
-- Exercises real RLS by switching `SET LOCAL ROLE authenticated` for the
-- visibility assertions, combined with
-- set_config('request.jwt.claim.sub', <uid>, true) to impersonate each user.
--
-- What it proves:
--   1. A task entering a stage matching an active harvest_rules row
--      harvests its latest submission's files as harvested_files pointers
--      (NOT new filehub_files/filehub_file_versions rows) -- both for the
--      dynamic per-project fallback (destination_folder_id IS NULL ->
--      fn_project_ensure_deliverable_folder(task's own project)) and the
--      explicit-override path (destination_folder_id IS NOT NULL).
--   2. FAN-OUT: a task matching two active rules simultaneously harvests to
--      BOTH destinations in the same stage-entry event.
--   3. rpc_project_files reads deliverable_files/deliverable_versions
--      correctly through the new harvested_files -> filehub_file_versions
--      join.
--   4. IDEMPOTENT: re-entering the stage with an unchanged submission is a
--      no-op (ON CONFLICT DO NOTHING on (destination_folder_id,
--      source_file_version_id) -- no manual EXISTS/CONTINUE check).
--   5. IMMUTABLE: a second submission that replaces the SAME underlying
--      file with a new version, followed by a genuine re-entry, adds a
--      NEW harvested_files pointer (files_replaced, not files_added) while
--      the FIRST pointer is untouched (same id, same source_file_version_id)
--      -- a later harvest never rewrites an earlier one.
--   6. VISIBILITY: an outsider (no project access) cannot see the harvested
--      pointer rows via RLS, cannot resolve the project's deliverable
--      folder, and rpc_project_files raises "Project not found." -- while
--      the task assignee (project-accessible) sees both harvested versions
--      via rpc_project_files. Still gated by fn_project_accessible, no
--      widening.
--   7. rpc_client_ensure_standing_folder remains a true idempotent
--      get-or-create (unrelated to harvest, unaffected by this rewrite).
--   8. pipeline_stages.harvests_to_deliverable is still reachable through
--      rpc_add_stage/rpc_update_stage -- inert dead schema now (Phase 2
--      deliberately leaves it, does not touch those RPCs), but must still
--      round-trip without erroring.

BEGIN;

CREATE TEMP TABLE pdlv_check_ctx (
  company       UUID,
  creator       UUID,
  u_assignee    UUID,
  u_outsider    UUID,
  pipeline      UUID,
  stage_intake  UUID,
  stage_seal    UUID,
  rule_dynamic  UUID,  -- destination_folder_id IS NULL -> per-project fallback
  rule_explicit UUID,  -- destination_folder_id IS NOT NULL -> override path
  folder_explicit UUID,
  project       UUID,
  task          UUID,
  submission1   UUID,
  src_file      UUID,  -- one filehub_files row, re-versioned for step 5
  version1      UUID,
  client        UUID,
  tag           TEXT
);
GRANT SELECT, INSERT, UPDATE ON pdlv_check_ctx TO authenticated;

-- ── Fixture setup (runs as postgres -- bypasses RLS) ────────────────────────
DO $$
DECLARE
  v_company        UUID;
  v_creator        UUID;
  v_pool           UUID[];
  v_pipeline       UUID;
  v_stage_intake   UUID;
  v_stage_seal     UUID;
  v_pos            INT;
  v_rule_dynamic   UUID;
  v_rule_explicit  UUID;
  v_folder_explicit UUID;
  v_project        UUID;
  v_task           UUID;
  v_submission1    UUID;
  v_src_file       UUID;
  v_version1       UUID;
  v_client         UUID;
  v_tag            TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  SELECT p.company_id, p.id, s.id
  INTO v_company, v_pipeline, v_stage_intake
  FROM public.pipelines p
  JOIN LATERAL (
    SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1
  ) s ON true
  WHERE p.deleted_at IS NULL
    AND (SELECT COUNT(*) FROM public.users u WHERE u.company_id = p.company_id AND u.is_owner = false) >= 2
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No company with a stage-having pipeline and >=2 non-owner users found -- seed one before running this check.';
  END IF;

  SELECT id INTO v_creator FROM public.users WHERE is_owner = true AND company_id = v_company LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No owner user found for company %.', v_company;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT id FROM public.users WHERE company_id = v_company AND is_owner = false ORDER BY id LIMIT 2
  ) x;
  IF v_pool IS NULL OR ARRAY_LENGTH(v_pool, 1) < 2 THEN
    RAISE EXCEPTION 'Need 2 distinct non-owner users in company % -- seed data too thin.', v_company;
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, p.id
  FROM public.user_roles ur
  JOIN public.permissions p ON p.key = 'project.view'
  WHERE ur.user_id = ANY (v_pool[1:2]) AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  -- A throwaway stage -- never touches any stage a real board depends on.
  -- No harvests_to_deliverable=true needed anymore -- the trigger no longer
  -- reads that column, only harvest_rules.
  SELECT COALESCE(MAX(position), 0) + 100 INTO v_pos FROM public.pipeline_stages WHERE pipeline_id = v_pipeline;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipeline, 'PDLV Selfcheck Sealed ' || v_tag, v_pos)
  RETURNING id INTO v_stage_seal;

  -- Two active rules matching the SAME stage+pipeline -- the fan-out
  -- fixture. rule_dynamic uses the (only reachable today) NULL destination
  -- fallback; rule_explicit pre-sets destination_folder_id, exercising the
  -- override branch nothing can reach via a real RPC yet.
  INSERT INTO public.filehub_folders (company_id, name, created_by, scope)
  VALUES (v_company, 'PDLV Selfcheck Explicit Dest ' || v_tag, v_creator, 'broadcast')
  RETURNING id INTO v_folder_explicit;

  INSERT INTO public.harvest_rules (company_id, pipeline_id, source_stage_id, condition_type, destination_folder_id, is_active, created_by)
  VALUES (v_company, v_pipeline, v_stage_seal, 'stage_entry', NULL, true, v_creator)
  RETURNING id INTO v_rule_dynamic;

  INSERT INTO public.harvest_rules (company_id, pipeline_id, source_stage_id, condition_type, destination_folder_id, is_active, created_by)
  VALUES (v_company, v_pipeline, v_stage_seal, 'stage_entry', v_folder_explicit, true, v_creator)
  RETURNING id INTO v_rule_explicit;

  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company, 'PDLV Selfcheck Project ' || v_tag, v_creator)
  RETURNING id INTO v_project;

  INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, created_by)
  VALUES (v_company, 'PDLV Selfcheck Task ' || v_tag, v_project, v_pipeline, v_stage_intake, v_creator)
  RETURNING id INTO v_task;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task, v_company, v_pool[1], v_creator);

  -- First submission + its FileHub pointer (visibility='task'), WITH a real
  -- filehub_file_versions row and current_version_id set -- fn_harvest_
  -- task_output now reads current_version_id directly, unlike the old
  -- mechanism which only needed storage_path/bucket off filehub_files.
  INSERT INTO public.task_submissions (task_id, company_id, submitted_by, status, submitted_at)
  VALUES (v_task, v_company, v_pool[1], 'pending', now())
  RETURNING id INTO v_submission1;

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, task_id)
  VALUES (v_company, v_pool[1], 'selfcheck/pdlv/' || v_tag || '/v1.txt', 'submission-attachments', 'output-v1.txt', 'text/plain', 10, 'task', v_task)
  RETURNING id INTO v_src_file;

  INSERT INTO public.filehub_file_versions (file_id, company_id, version_no, storage_path, bucket, original_name, size_bytes, mime_type, created_by)
  VALUES (v_src_file, v_company, 1, 'selfcheck/pdlv/' || v_tag || '/v1.txt', 'submission-attachments', 'output-v1.txt', 10, 'text/plain', v_pool[1])
  RETURNING id INTO v_version1;

  UPDATE public.filehub_files SET current_version_id = v_version1 WHERE id = v_src_file;

  INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path, filehub_file_id)
  VALUES (v_submission1, v_company, v_pool[1], 'output-v1.txt', 'https://example.invalid/dummy-v1', 'selfcheck/pdlv/' || v_tag || '/v1.txt', v_src_file);

  INSERT INTO public.clients (company_id, name)
  VALUES (v_company, 'PDLV Selfcheck Client ' || v_tag)
  RETURNING id INTO v_client;

  INSERT INTO pdlv_check_ctx (
    company, creator, u_assignee, u_outsider, pipeline, stage_intake, stage_seal,
    rule_dynamic, rule_explicit, folder_explicit, project, task, submission1, src_file, version1, client, tag
  ) VALUES (
    v_company, v_creator, v_pool[1], v_pool[2], v_pipeline, v_stage_intake, v_stage_seal,
    v_rule_dynamic, v_rule_explicit, v_folder_explicit, v_project, v_task, v_submission1, v_src_file, v_version1, v_client, v_tag
  );
END $$;

-- ── 1. First harvest: fan-out to both rules, as harvested_files pointers ───
DO $$
DECLARE
  c                RECORD;
  v_folder_dynamic UUID;
  v_dup_filehub    INT;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  UPDATE public.tasks SET current_stage_id = c.stage_seal WHERE id = c.task;

  SELECT deliverable_folder_id INTO v_folder_dynamic FROM public.projects WHERE id = c.project;
  IF v_folder_dynamic IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): deliverable_folder_id was not lazily created by the dynamic-fallback rule';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = c.rule_dynamic AND source_file_version_id = c.version1
      AND destination_folder_id = v_folder_dynamic AND source_task_id = c.task
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): rule_dynamic did not harvest v1 into the project''s own deliverable folder';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = c.rule_explicit AND source_file_version_id = c.version1
      AND destination_folder_id = c.folder_explicit AND source_task_id = c.task
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (1c) [FAN-OUT]: rule_explicit did not ALSO harvest v1 into its own override destination -- a task matching two active rules must harvest to both';
  END IF;

  IF v_folder_dynamic = c.folder_explicit THEN
    RAISE EXCEPTION 'CHECK FAILED (1d): fixture invalid -- dynamic and explicit destinations must be distinct folders to prove fan-out lands in two places';
  END IF;

  -- Regression guard: the OLD mechanism duplicated a filehub_files +
  -- filehub_file_versions row per harvest. Prove that no longer happens.
  SELECT COUNT(*) INTO v_dup_filehub FROM public.filehub_files WHERE company_id = c.company AND visibility = 'project';
  IF v_dup_filehub <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1e): harvest created % filehub_files row(s) with visibility=project -- Phase 2 must harvest via harvested_files pointers only, never new filehub_files rows', v_dup_filehub;
  END IF;

  RAISE NOTICE 'OK (1): first harvest fanned out to both active rules as harvested_files pointers (dynamic folder %, explicit folder %) -- no duplicate filehub_files row created.', v_folder_dynamic, c.folder_explicit;
END $$;

-- ── 2. rpc_project_files reads the new join correctly ───────────────────────
DO $$
DECLARE
  c        RECORD;
  v_result JSONB;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  v_result := public.rpc_project_files(c.project);

  IF jsonb_array_length(v_result -> 'deliverable_files') <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2a): rpc_project_files should list 1 harvested file (only the dynamic-folder pointer is IN the project''s own deliverable folder), got %', v_result -> 'deliverable_files';
  END IF;
  IF (v_result -> 'deliverable_files' -> 0 ->> 'storage_path') IS DISTINCT FROM 'selfcheck/pdlv/' || c.tag || '/v1.txt' THEN
    RAISE EXCEPTION 'CHECK FAILED (2b): deliverable_files storage_path mismatch: %', v_result -> 'deliverable_files';
  END IF;
  IF (v_result -> 'deliverable_files' -> 0 ->> 'size_bytes')::int <> 10 THEN
    RAISE EXCEPTION 'CHECK FAILED (2c): deliverable_files size_bytes did not come through the filehub_file_versions join correctly: %', v_result -> 'deliverable_files';
  END IF;
  IF jsonb_array_length(v_result -> 'deliverable_versions') <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2d): rpc_project_files should report 1 deliverable version (one harvest event), got %', v_result -> 'deliverable_versions';
  END IF;
  IF (v_result -> 'deliverable_versions' -> 0 ->> 'files_added')::int <> 1
     OR (v_result -> 'deliverable_versions' -> 0 ->> 'files_replaced')::int <> 0
     OR (v_result -> 'deliverable_versions' -> 0 ->> 'is_effective')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CHECK FAILED (2e): first deliverable_versions entry has wrong shape: %', v_result -> 'deliverable_versions' -> 0;
  END IF;

  RAISE NOTICE 'OK (2): rpc_project_files reconstructs deliverable_files/deliverable_versions correctly through the harvested_files -> filehub_file_versions join.';
END $$;

-- ── 3. Idempotent: re-entering the stage with no new submission adds nothing ─
DO $$
DECLARE
  c        RECORD;
  v_before INT;
  v_after  INT;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  SELECT COUNT(*) INTO v_before FROM public.harvested_files WHERE company_id = c.company;

  UPDATE public.tasks SET current_stage_id = c.stage_intake WHERE id = c.task;
  UPDATE public.tasks SET current_stage_id = c.stage_seal WHERE id = c.task;

  SELECT COUNT(*) INTO v_after FROM public.harvested_files WHERE company_id = c.company;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'CHECK FAILED (3): re-harvesting an unchanged submission created % new harvested_files row(s) -- ON CONFLICT DO NOTHING idempotency is broken', v_after - v_before;
  END IF;

  RAISE NOTICE 'OK (3): re-entering the stage with no new submission is a no-op (% harvested_files rows, unchanged).', v_after;
END $$;

-- ── 4. A new VERSION of the same underlying file: immutable v1, added v2 ────
DO $$
DECLARE
  c             RECORD;
  v_submission2 UUID;
  v_version2    UUID;
  v_folder_dynamic UUID;
  v_result      JSONB;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  INSERT INTO public.task_submissions (task_id, company_id, submitted_by, status, submitted_at)
  VALUES (c.task, c.company, c.u_assignee, 'pending', now() + interval '1 second')
  RETURNING id INTO v_submission2;

  -- The SAME underlying file (c.src_file), a new version -- models "the
  -- task's output changed between submissions."
  INSERT INTO public.filehub_file_versions (file_id, company_id, version_no, storage_path, bucket, original_name, size_bytes, mime_type, created_by)
  VALUES (c.src_file, c.company, 2, 'selfcheck/pdlv/' || c.tag || '/v2.txt', 'submission-attachments', 'output-v2.txt', 20, 'text/plain', c.u_assignee)
  RETURNING id INTO v_version2;

  UPDATE public.filehub_files SET current_version_id = v_version2 WHERE id = c.src_file;

  INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path, filehub_file_id)
  VALUES (v_submission2, c.company, c.u_assignee, 'output-v2.txt', 'https://example.invalid/dummy-v2', 'selfcheck/pdlv/' || c.tag || '/v2.txt', c.src_file);

  -- The source file changed, but the stage was NOT re-entered yet -- the
  -- v1 harvested pointer must be untouched.
  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = c.rule_dynamic AND source_file_version_id = c.version1
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (4a): the v1 harvested_files pointer was removed/mutated before any re-harvest happened';
  END IF;

  -- Genuine re-entry.
  UPDATE public.tasks SET current_stage_id = c.stage_intake WHERE id = c.task;
  UPDATE public.tasks SET current_stage_id = c.stage_seal WHERE id = c.task;

  SELECT deliverable_folder_id INTO v_folder_dynamic FROM public.projects WHERE id = c.project;

  -- v1 pointer still exists, unchanged, in both destinations.
  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = c.rule_dynamic AND source_file_version_id = c.version1 AND destination_folder_id = v_folder_dynamic
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (4b): the v1 harvested_files pointer is missing after the re-harvest -- a later harvest must never delete/rewrite an earlier one';
  END IF;

  -- v2 pointer now exists as its OWN row, in both destinations (fan-out
  -- still holds on the second harvest event).
  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = c.rule_dynamic AND source_file_version_id = v_version2 AND destination_folder_id = v_folder_dynamic
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (4c): v2 was not harvested via rule_dynamic on the re-entry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = c.rule_explicit AND source_file_version_id = v_version2 AND destination_folder_id = c.folder_explicit
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (4d): v2 was not ALSO harvested via rule_explicit on the re-entry -- fan-out must hold on every harvest event, not just the first';
  END IF;

  v_result := public.rpc_project_files(c.project);
  IF jsonb_array_length(v_result -> 'deliverable_files') <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4e): rpc_project_files should list 2 harvested files after the second harvest event, got %', v_result -> 'deliverable_files';
  END IF;
  IF jsonb_array_length(v_result -> 'deliverable_versions') <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4f): rpc_project_files should report 2 deliverable versions (2 distinct harvested_at events), got %', v_result -> 'deliverable_versions';
  END IF;
  -- Versions are ordered seq DESC -- index 0 is the newest (v2's) batch,
  -- which must read as a "replace" of the same underlying file, not an "add".
  IF (v_result -> 'deliverable_versions' -> 0 ->> 'files_added')::int <> 0
     OR (v_result -> 'deliverable_versions' -> 0 ->> 'files_replaced')::int <> 1
     OR (v_result -> 'deliverable_versions' -> 0 ->> 'is_effective')::boolean IS DISTINCT FROM true
     OR (v_result -> 'deliverable_versions' -> 0 ->> 'seq')::int <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4g): the second harvest batch must read as a replace (same underlying file, newer version), not an add: %', v_result -> 'deliverable_versions' -> 0;
  END IF;
  IF (v_result -> 'deliverable_versions' -> 1 ->> 'is_effective')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CHECK FAILED (4h): the first (older) batch must no longer be flagged effective once a newer batch exists: %', v_result -> 'deliverable_versions' -> 1;
  END IF;

  RAISE NOTICE 'OK (4): a new version of the same underlying file adds a NEW harvested_files pointer (flagged as a replace) while the original pointer stays untouched; fan-out holds on the second harvest event too.';
END $$;

-- ── 5. Visibility: outsider blocked everywhere, assignee sees both versions ──
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c        RECORD;
  v_ok     BOOLEAN;
  v_msg    TEXT;
  v_raised BOOLEAN := false;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_outsider::text, true);

  SELECT public.fn_project_accessible(c.project) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5a): outsider should not see the project';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = c.rule_dynamic AND source_file_version_id = c.version1
  ) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): outsider can read the harvested pointer row via RLS';
  END IF;

  SELECT public.filehub_folder_accessible(
    (SELECT deliverable_folder_id FROM public.projects WHERE id = c.project)
  ) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5c): outsider resolves the deliverable folder as accessible';
  END IF;

  BEGIN
    PERFORM public.rpc_project_files(c.project);
    v_raised := true; -- reached only if it did NOT raise
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (5d): rpc_project_files returned data to an outsider';
  END IF;
  IF v_msg IS DISTINCT FROM 'Project not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (5d): expected "Project not found.", got: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (5a-d): a user who cannot see the project cannot reach the harvested pointer row, the folder, or rpc_project_files -- no widening.';
END $$;

DO $$
DECLARE
  c        RECORD;
  v_ok     BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  SELECT EXISTS(
    SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = c.rule_dynamic AND source_file_version_id = c.version1
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5e): the assignee (project-accessible) cannot read the sealed v1 pointer';
  END IF;

  v_result := public.rpc_project_files(c.project);
  IF jsonb_array_length(v_result -> 'deliverable_files') <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (5f): rpc_project_files should list 2 harvested files for the assignee, got %', v_result -> 'deliverable_files';
  END IF;

  RAISE NOTICE 'OK (5e-f): a project-accessible user (task assignee) sees both harvested versions via rpc_project_files.';
END $$;

RESET ROLE;

-- ── 6. rpc_client_ensure_standing_folder is a true idempotent get-or-create ──
DO $$
DECLARE
  c      RECORD;
  v_id1  UUID;
  v_id2  UUID;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);

  SELECT public.rpc_client_ensure_standing_folder(c.client) INTO v_id1;
  SELECT public.rpc_client_ensure_standing_folder(c.client) INTO v_id2;

  IF v_id1 IS DISTINCT FROM v_id2 THEN
    RAISE EXCEPTION 'CHECK FAILED (6): rpc_client_ensure_standing_folder is not idempotent: % vs %', v_id1, v_id2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = c.client AND standing_folder_id = v_id1) THEN
    RAISE EXCEPTION 'CHECK FAILED (6): clients.standing_folder_id was not persisted';
  END IF;

  RAISE NOTICE 'OK (6): rpc_client_ensure_standing_folder is idempotent (folder %), unaffected by the harvest rewrite.', v_id1;
END $$;

-- ── 7. pipeline_stages.harvests_to_deliverable still round-trips (now inert
--    dead schema, but Phase 2 deliberately does not touch these RPCs) ──────
DO $$
DECLARE
  c           RECORD;
  v_new_stage UUID;
  v_flag      BOOLEAN;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);

  SELECT public.rpc_add_stage(c.pipeline, 'PDLV Selfcheck RPC Stage ' || c.tag, p_harvests_to_deliverable := true) INTO v_new_stage;
  SELECT harvests_to_deliverable INTO v_flag FROM public.pipeline_stages WHERE id = v_new_stage;
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CHECK FAILED (7a): rpc_add_stage(p_harvests_to_deliverable := true) did not persist';
  END IF;

  PERFORM public.rpc_update_stage(v_new_stage, p_harvests_to_deliverable := false);
  SELECT harvests_to_deliverable INTO v_flag FROM public.pipeline_stages WHERE id = v_new_stage;
  IF v_flag IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CHECK FAILED (7b): rpc_update_stage(p_harvests_to_deliverable := false) did not persist';
  END IF;

  RAISE NOTICE 'OK (7): the (now inert) toggle still round-trips through rpc_add_stage / rpc_update_stage without erroring.';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: issue #284 Phase 2 -- fn_harvest_task_output/the stage-entry trigger write harvested_files pointers (never duplicate filehub_files/filehub_file_versions rows), fan out to every matching active rule, stay idempotent via ON CONFLICT DO NOTHING, preserve immutability of earlier pointers, and rpc_project_files reconstructs the same JSON shape through the new join -- all still gated by fn_project_accessible with no widening.';
END $$;

ROLLBACK;
