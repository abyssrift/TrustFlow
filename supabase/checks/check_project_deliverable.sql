-- Runnable check for issue #174: sealing a project deliverable as an
-- immutable FileHub folder version via the per-stage harvest toggle.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_project_deliverable.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates one throwaway project/task/pipeline
-- stage in an existing seeded company (reusing real users, never inventing
-- auth.users rows -- same convention as 20260801_project_visibility_check.sql,
-- which this mirrors), always rolls back, safe to re-run.
--
-- Exercises real RLS by switching `SET LOCAL ROLE authenticated` for the
-- visibility assertions (the default `postgres` connection role is BYPASSRLS,
-- which would prove nothing) combined with
-- set_config('request.jwt.claim.sub', <uid>, true) to impersonate each user.
--
-- What it proves, matching the issue's acceptance criteria literally:
--   1. Moving a task into a harvests_to_deliverable stage lazily creates
--      projects.deliverable_folder_id and promotes the task's latest
--      submission's attachment into it as a NEW filehub_files row
--      (visibility='project'), pointing at the SAME storage_path (no bytes
--      copied).
--   2. IMMUTABLE: after a second submission + a genuine re-entry into the
--      harvest stage, the FIRST harvested row is untouched (same id, same
--      storage_path) -- changing the task's file does not alter the sealed
--      version -- AND it still opens (still selectable, not soft-deleted).
--      The folder now reads as 2 distinct versions (count(distinct batch_id)
--      AND rpc_filehub_folder_versions agree).
--   3. IDEMPOTENT: re-entering the stage again with no new submission does
--      not create a third row.
--   4. VISIBILITY: a user with no assignment to the project and no
--      project.view_all cannot see the harvested file (RLS), cannot resolve
--      the deliverable folder (filehub_folder_accessible), and
--      rpc_project_files raises "Project not found." -- while a user who IS
--      assigned a task in the project (the assignee) can see both harvested
--      versions via rpc_project_files. A sealed deliverable never becomes a
--      way to read a file its viewer could not already reach via the project.
--   5. rpc_client_ensure_standing_folder is a true idempotent get-or-create.

BEGIN;

CREATE TEMP TABLE pdlv_check_ctx (
  company      UUID,
  creator      UUID,
  u_assignee   UUID,
  u_outsider   UUID,
  pipeline     UUID,
  stage_intake UUID,
  stage_seal   UUID,
  project      UUID,
  task         UUID,
  submission1  UUID,
  submission2  UUID,
  src_file1    UUID,
  src_file2    UUID,
  client       UUID,
  tag          TEXT
);
GRANT SELECT, INSERT, UPDATE ON pdlv_check_ctx TO authenticated;

-- ── Fixture setup (runs as postgres -- bypasses RLS, has table grants) ─────
DO $$
DECLARE
  v_company      UUID;
  v_creator      UUID;
  v_pool         UUID[];
  v_pipeline     UUID;
  v_stage_intake UUID;
  v_stage_seal   UUID;
  v_pos          INT;
  v_project      UUID;
  v_task         UUID;
  v_submission1  UUID;
  v_src_file1    UUID;
  v_client       UUID;
  v_tag          TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  -- A company with a stage-having pipeline AND at least 2 non-owner users
  -- (same discovery pattern as check_rpc_spreadsheet_intake.sql, extended
  -- with the user-count requirement this check also needs).
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

  -- 2 distinct non-owner users: the task assignee, and an outsider with no
  -- assignment anywhere in this project.
  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT id FROM public.users WHERE company_id = v_company AND is_owner = false ORDER BY id LIMIT 2
  ) x;
  IF v_pool IS NULL OR ARRAY_LENGTH(v_pool, 1) < 2 THEN
    RAISE EXCEPTION 'Need 2 distinct non-owner users in company % -- seed data too thin.', v_company;
  END IF;

  -- project.view is a pre-existing screen-level gate, unrelated to what this
  -- check tests -- grant it so it can never be mistaken for the row-level
  -- (fn_project_accessible) denial being asserted below. Same reasoning as
  -- 20260801_project_visibility_check.sql.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, p.id
  FROM public.user_roles ur
  JOIN public.permissions p ON p.key = 'project.view'
  WHERE ur.user_id = ANY (v_pool[1:2]) AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  -- A throwaway harvest stage on the existing pipeline -- never touches any
  -- stage a real board depends on, and the whole thing rolls back.
  SELECT COALESCE(MAX(position), 0) + 100 INTO v_pos FROM public.pipeline_stages WHERE pipeline_id = v_pipeline;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, harvests_to_deliverable)
  VALUES (v_pipeline, 'PDLV Selfcheck Sealed ' || v_tag, v_pos, true)
  RETURNING id INTO v_stage_seal;

  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company, 'PDLV Selfcheck Project ' || v_tag, v_creator)
  RETURNING id INTO v_project;

  INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, created_by)
  VALUES (v_company, 'PDLV Selfcheck Task ' || v_tag, v_project, v_pipeline, v_stage_intake, v_creator)
  RETURNING id INTO v_task;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task, v_company, v_pool[1], v_creator);

  -- First submission + its FileHub pointer (visibility='task', exactly the
  -- shape filehub_link_task_file produces for real submission uploads).
  INSERT INTO public.task_submissions (task_id, company_id, submitted_by, status, submitted_at)
  VALUES (v_task, v_company, v_pool[1], 'pending', now())
  RETURNING id INTO v_submission1;

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, task_id)
  VALUES (v_company, v_pool[1], 'selfcheck/pdlv/' || v_tag || '/v1.txt', 'submission-attachments', 'output-v1.txt', 'text/plain', 10, 'task', v_task)
  RETURNING id INTO v_src_file1;

  INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path, filehub_file_id)
  VALUES (v_submission1, v_company, v_pool[1], 'output-v1.txt', 'https://example.invalid/dummy-v1', 'selfcheck/pdlv/' || v_tag || '/v1.txt', v_src_file1);

  INSERT INTO public.clients (company_id, name)
  VALUES (v_company, 'PDLV Selfcheck Client ' || v_tag)
  RETURNING id INTO v_client;

  INSERT INTO pdlv_check_ctx (
    company, creator, u_assignee, u_outsider, pipeline, stage_intake, stage_seal,
    project, task, submission1, src_file1, client, tag
  ) VALUES (
    v_company, v_creator, v_pool[1], v_pool[2], v_pipeline, v_stage_intake, v_stage_seal,
    v_project, v_task, v_submission1, v_src_file1, v_client, v_tag
  );
END $$;

-- ── 1. First harvest: moving the task into the sealed stage promotes v1 ────
DO $$
DECLARE
  c              RECORD;
  v_folder       UUID;
  v_harvested_id UUID;
  v_src_path     TEXT;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  UPDATE public.tasks SET current_stage_id = c.stage_seal WHERE id = c.task;

  SELECT deliverable_folder_id INTO v_folder FROM public.projects WHERE id = c.project;
  IF v_folder IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1): deliverable_folder_id was not lazily created on first harvest';
  END IF;

  SELECT id, storage_path INTO v_harvested_id, v_src_path
  FROM public.filehub_files
  WHERE folder_id = v_folder AND visibility = 'project' AND project_id = c.project
    AND deleted_at IS NULL;

  IF v_harvested_id IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1): no file was promoted into the deliverable folder';
  END IF;
  IF v_src_path IS DISTINCT FROM 'selfcheck/pdlv/' || c.tag || '/v1.txt' THEN
    RAISE EXCEPTION 'CHECK FAILED (1): harvested storage_path %, expected the source v1 path (no bytes should be copied/renamed)', v_src_path;
  END IF;

  RAISE NOTICE 'OK (1): harvest promoted v1 into the deliverable folder %, file %', v_folder, v_harvested_id;
END $$;

-- Stash the v1 harvested file id for the immutability assertions below.
ALTER TABLE pdlv_check_ctx ADD COLUMN IF NOT EXISTS harvested_v1 UUID;
UPDATE pdlv_check_ctx SET harvested_v1 = (
  SELECT f.id FROM public.filehub_files f
  JOIN public.projects p ON p.deliverable_folder_id = f.folder_id
  WHERE p.id = (SELECT project FROM pdlv_check_ctx) AND f.visibility = 'project'
);

-- ── 2. Second submission + a genuine re-entry -> immutability + a 2nd version ─
DO $$
DECLARE
  c             RECORD;
  v_submission2 UUID;
  v_src_file2   UUID;
  v_folder      UUID;
  v_v1_path_now TEXT;
  v_batches     INT;
  v_versions    JSONB;
  v_count_rows  INT;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  INSERT INTO public.task_submissions (task_id, company_id, submitted_by, status, submitted_at)
  VALUES (c.task, c.company, c.u_assignee, 'pending', now() + interval '1 second')
  RETURNING id INTO v_submission2;

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, task_id)
  VALUES (c.company, c.u_assignee, 'selfcheck/pdlv/' || c.tag || '/v2.txt', 'submission-attachments', 'output-v2.txt', 'text/plain', 20, 'task', c.task)
  RETURNING id INTO v_src_file2;

  INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path, filehub_file_id)
  VALUES (v_submission2, c.company, c.u_assignee, 'output-v2.txt', 'https://example.invalid/dummy-v2', 'selfcheck/pdlv/' || c.tag || '/v2.txt', v_src_file2);

  -- The task's file changed (a new submission exists), but the harvest stage
  -- was NOT re-entered yet -- literal acceptance test: "changing a task's
  -- file must not alter the sealed version."
  SELECT storage_path INTO v_v1_path_now FROM public.filehub_files WHERE id = c.harvested_v1;
  IF v_v1_path_now IS DISTINCT FROM 'selfcheck/pdlv/' || c.tag || '/v1.txt' THEN
    RAISE EXCEPTION 'CHECK FAILED (2a): sealed v1 row mutated after the task''s file changed: now %', v_v1_path_now;
  END IF;

  -- Now the genuine re-entry: out of the stage, then back in.
  UPDATE public.tasks SET current_stage_id = c.stage_intake WHERE id = c.task;
  UPDATE public.tasks SET current_stage_id = c.stage_seal WHERE id = c.task;

  SELECT deliverable_folder_id INTO v_folder FROM public.projects WHERE id = c.project;

  -- v1 still exists, unchanged, still opens (not soft-deleted, same id).
  SELECT storage_path INTO v_v1_path_now FROM public.filehub_files WHERE id = c.harvested_v1 AND deleted_at IS NULL;
  IF v_v1_path_now IS DISTINCT FROM 'selfcheck/pdlv/' || c.tag || '/v1.txt' THEN
    RAISE EXCEPTION 'CHECK FAILED (2b): sealed v1 row missing or mutated after re-harvest: %', v_v1_path_now;
  END IF;

  -- v2 now exists as its OWN row.
  SELECT COUNT(*) INTO v_count_rows
  FROM public.filehub_files
  WHERE folder_id = v_folder AND visibility = 'project' AND deleted_at IS NULL
    AND storage_path = 'selfcheck/pdlv/' || c.tag || '/v2.txt';
  IF v_count_rows <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2c): expected exactly 1 harvested v2 row, got %', v_count_rows;
  END IF;

  -- Folder now reads as 2 distinct versions (batch_id-derived, no counter column).
  SELECT COUNT(DISTINCT v.batch_id) INTO v_batches
  FROM public.filehub_file_versions v
  JOIN public.filehub_files f ON f.id = v.file_id
  WHERE f.folder_id = v_folder AND f.deleted_at IS NULL AND v.batch_id IS NOT NULL;
  IF v_batches <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (2d): expected 2 distinct batch_ids in the deliverable folder, got %', v_batches;
  END IF;

  SELECT public.rpc_filehub_folder_versions(v_folder) INTO v_versions;
  IF jsonb_array_length(v_versions) <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (2e): rpc_filehub_folder_versions disagrees with the raw batch count: %', v_versions;
  END IF;

  RAISE NOTICE 'OK (2): immutability holds across a real re-harvest -- v1 untouched, v2 added, folder reads as 2 versions (%).', v_versions;
END $$;

-- ── 3. Idempotent: re-entering again with no new submission adds nothing ────
DO $$
DECLARE
  c        RECORD;
  v_folder UUID;
  v_before INT;
  v_after  INT;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  SELECT deliverable_folder_id INTO v_folder FROM public.projects WHERE id = c.project;
  SELECT COUNT(*) INTO v_before FROM public.filehub_files WHERE folder_id = v_folder AND deleted_at IS NULL;

  UPDATE public.tasks SET current_stage_id = c.stage_intake WHERE id = c.task;
  UPDATE public.tasks SET current_stage_id = c.stage_seal WHERE id = c.task;

  SELECT COUNT(*) INTO v_after FROM public.filehub_files WHERE folder_id = v_folder AND deleted_at IS NULL;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'CHECK FAILED (3): re-harvesting an unchanged submission created % new row(s)', v_after - v_before;
  END IF;

  RAISE NOTICE 'OK (3): re-entering the stage with no new submission is a no-op (% files, unchanged)', v_after;
END $$;

-- ── 4. Visibility: outsider blocked everywhere, assignee sees both versions ──
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
    RAISE EXCEPTION 'CHECK FAILED (4a): outsider should not see the project';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.filehub_files WHERE id = c.harvested_v1) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (4b): outsider can read the harvested deliverable file via RLS';
  END IF;

  SELECT public.filehub_folder_accessible(
    (SELECT deliverable_folder_id FROM public.projects WHERE id = c.project)
  ) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (4c): outsider resolves the deliverable folder as accessible';
  END IF;

  BEGIN
    PERFORM public.rpc_project_files(c.project);
    v_raised := true; -- reached only if it did NOT raise
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (4d): rpc_project_files returned data to an outsider';
  END IF;
  IF v_msg IS DISTINCT FROM 'Project not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (4d): expected "Project not found.", got: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (4a-d): a user who cannot see the project cannot reach the deliverable file, the folder, or rpc_project_files -- no widening.';
END $$;

DO $$
DECLARE
  c        RECORD;
  v_ok     BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_assignee::text, true);

  SELECT EXISTS(SELECT 1 FROM public.filehub_files WHERE id = c.harvested_v1) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (4e): the assignee (project-accessible) cannot read the sealed v1 file';
  END IF;

  v_result := public.rpc_project_files(c.project);
  IF jsonb_array_length(v_result -> 'deliverable_files') <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4f): rpc_project_files should list 2 harvested files, got %', v_result -> 'deliverable_files';
  END IF;
  IF jsonb_array_length(v_result -> 'deliverable_versions') <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4g): rpc_project_files should report 2 deliverable versions, got %', v_result -> 'deliverable_versions';
  END IF;

  RAISE NOTICE 'OK (4e-g): a project-accessible user (task assignee) sees both harvested versions via rpc_project_files.';
END $$;

RESET ROLE;

-- ── 5. rpc_client_ensure_standing_folder is a true idempotent get-or-create ──
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
    RAISE EXCEPTION 'CHECK FAILED (5): rpc_client_ensure_standing_folder is not idempotent: % vs %', v_id1, v_id2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = c.client AND standing_folder_id = v_id1) THEN
    RAISE EXCEPTION 'CHECK FAILED (5): clients.standing_folder_id was not persisted';
  END IF;

  RAISE NOTICE 'OK (5): rpc_client_ensure_standing_folder is idempotent (folder %), distinct from the project deliverable folder.', v_id1;
END $$;

-- ── 6. The toggle is actually reachable through the stage editor RPCs ───────
-- Plan §13.8's exact trap: schema nobody can reach. rpc_add_stage /
-- rpc_update_stage must accept and persist harvests_to_deliverable, not just
-- the raw column.
DO $$
DECLARE
  c          RECORD;
  v_new_stage UUID;
  v_flag      BOOLEAN;
BEGIN
  SELECT * INTO c FROM pdlv_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);

  SELECT public.rpc_add_stage(c.pipeline, 'PDLV Selfcheck RPC Stage ' || c.tag, p_harvests_to_deliverable := true) INTO v_new_stage;
  SELECT harvests_to_deliverable INTO v_flag FROM public.pipeline_stages WHERE id = v_new_stage;
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CHECK FAILED (6a): rpc_add_stage(p_harvests_to_deliverable := true) did not persist';
  END IF;

  PERFORM public.rpc_update_stage(v_new_stage, p_harvests_to_deliverable := false);
  SELECT harvests_to_deliverable INTO v_flag FROM public.pipeline_stages WHERE id = v_new_stage;
  IF v_flag IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CHECK FAILED (6b): rpc_update_stage(p_harvests_to_deliverable := false) did not persist';
  END IF;

  RAISE NOTICE 'OK (6): the toggle is reachable and round-trips through rpc_add_stage / rpc_update_stage, not just the raw column.';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: issue #174 -- harvest promotes latest submission output into the sealed deliverable folder using FileHub''s existing batch_id folder versioning; sealed versions are immutable and re-readable; visibility follows fn_project_accessible with no widening; the toggle is reachable through the stage editor RPCs; client standing folder is a separate, idempotent, cross-year pointer.';
END $$;

ROLLBACK;
