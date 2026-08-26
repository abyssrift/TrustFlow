-- Runnable check for issue #284: a single consolidated end-to-end scenario
-- across the WHOLE harvest system (Phases 1-3 together), not isolated
-- pieces. check_harvest_rules_schema.sql, check_harvest_rules_rpc.sql, and
-- check_project_deliverable.sql already prove the individual mechanisms in
-- isolation (raw schema/RLS, the CRUD RPC surface, and the trigger/pointer
-- rewrite) -- this file is the gap those three don't cover: rule creation
-- via the real RPC surface -> a real stage-move trigger firing -> backfill
-- catching what predates a rule -> update/delete affecting subsequent
-- behaviour -> access control, all as ONE continuous flow against ONE
-- fixture, in the order a real workspace would actually hit them.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_harvest_e2e.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates one throwaway company (own users,
-- pipeline, stages, project -- does NOT touch seeded data), always rolls
-- back, safe to re-run. Stays as the `postgres` role throughout (same
-- rationale as check_harvest_rules_rpc.sql's header: the RPCs are SECURITY
-- DEFINER and only read auth.uid() off the request.jwt.claim.sub GUC, so
-- swapping that GUC is enough to impersonate each actor without RLS also
-- filtering this file's OWN assertion queries) -- except section 9's direct
-- harvested_files RLS check, which deliberately switches to
-- `SET LOCAL ROLE authenticated` to exercise the real policy.
--
-- Actor design: the fixture's `owner` user (is_owner = true) drives every
-- step of the main flow (1-8). has_permission() short-circuits TRUE for any
-- key when is_owner = true (confirmed via pg_get_functiondef before writing
-- this) -- so the owner exercises the RPCs' permission-holder path exactly
-- like check_harvest_rules_rpc.sql's u_editor already does, without a second
-- throwaway role. Section 9 introduces one additional user, `outsider`
-- (is_owner = false, granted ONLY 'project.view' via a dedicated role --
-- deliberately NOT 'pipeline.edit') to prove two DISTINCT denials: the 4
-- rule-authoring RPCs reject a same-company user who lacks pipeline.edit/
-- is_owner, and rpc_project_files + harvested_files RLS reject a user who
-- CAN see projects in general but isn't accessible to THIS one (no
-- assignment, no ownership) -- the realistic "no project access" shape,
-- not just a blanket permission failure.
--
-- What it proves (one continuous scenario):
--   1-2. rpc_create_harvest_rule (not a raw INSERT) creates a stage_entry
--        rule on a fresh pipeline/stage.
--   3.   A REAL `UPDATE tasks SET current_stage_id = ...` (not a direct
--        function call) fires the trigger; harvested_files gets the right
--        pointer row via the dynamic per-project destination fallback.
--   4.   rpc_project_files reflects it.
--   5.   A second rule (stage_terminal_success, source_stage_id NULL --
--        "any success stage") on the SAME pipeline fires independently for
--        a second task into its OWN (explicit) destination -- fan-out,
--        two rules, two results.
--   6.   rpc_backfill_harvest_rule picks up a pre-staged task the trigger
--        never touched, and is idempotent on a second call.
--   7.   rpc_update_harvest_rule(is_active = false) stops a subsequent
--        stage-move from harvesting via that rule.
--   8.   rpc_delete_harvest_rule hard-deletes the rule; its historical
--        harvested_files rows survive with harvest_rule_id set to NULL
--        (the cascade-fix regression, re-verified here in the full-flow
--        context -- and its destination folder's RLS still gates correctly
--        with the FK now NULL, proven in section 9).
--   9.   Access control: a user without pipeline.edit/is_owner cannot call
--        any of the 4 rule-authoring RPCs; a user without access to THIS
--        project cannot see the harvested content via rpc_project_files
--        (raises "Project not found.") or directly via harvested_files RLS,
--        even though the same user CAN see projects in general.

BEGIN;

CREATE TEMP TABLE he2e_check_ctx (
  company        UUID,
  owner_user     UUID,
  outsider       UUID,
  pipeline       UUID,
  stage_intake   UUID,
  stage_match    UUID,  -- rule1 (stage_entry) target
  stage_term     UUID,  -- rule2 (stage_terminal_success) target -- is_terminal/success
  project        UUID,
  tag            TEXT
);
GRANT SELECT ON he2e_check_ctx TO authenticated;

-- ── Fixture setup (runs as postgres -- bypasses RLS) ────────────────────────
DO $$
DECLARE
  v_company      UUID;
  v_owner        UUID := gen_random_uuid();
  v_outsider     UUID := gen_random_uuid();
  v_pipeline     UUID;
  v_stage_intake UUID;
  v_stage_match  UUID;
  v_stage_term   UUID;
  v_project      UUID;
  v_role_viewer  UUID;
  v_tag          TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO public.companies (name, slug)
  VALUES ('HE2E Selfcheck Co ' || v_tag, 'he2e-selfcheck-' || v_tag)
  RETURNING id INTO v_company;

  INSERT INTO auth.users (id, email) VALUES (v_owner, 'he2e-owner-' || v_tag || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner)
  VALUES (v_owner, v_company, 'he2e-owner-' || v_tag || '@test.local', true);

  INSERT INTO auth.users (id, email) VALUES (v_outsider, 'he2e-outsider-' || v_tag || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner)
  VALUES (v_outsider, v_company, 'he2e-outsider-' || v_tag || '@test.local', false);

  -- outsider gets project.view (so rpc_project_files' outer permission gate
  -- passes and the DENIAL under test is specifically fn_project_accessible,
  -- the realistic "no access to THIS project" shape) but deliberately NOT
  -- pipeline.edit (so section 9's RPC-denial assertions test the real gate,
  -- not an accidental extra grant).
  INSERT INTO public.roles (company_id, name, is_system, is_default)
  VALUES (v_company, 'HE2E Selfcheck Viewer ' || v_tag, false, false)
  RETURNING id INTO v_role_viewer;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_viewer, id FROM public.permissions WHERE key = 'project.view';

  INSERT INTO public.user_roles (user_id, role_id, company_id)
  VALUES (v_outsider, v_role_viewer, v_company);

  INSERT INTO public.pipelines (company_id, name, subject_kind, created_by)
  VALUES (v_company, 'HE2E Selfcheck Pipeline ' || v_tag, 'task', v_owner)
  RETURNING id INTO v_pipeline;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline, 'HE2E Selfcheck Intake ' || v_tag, 1, true)
  RETURNING id INTO v_stage_intake;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipeline, 'HE2E Selfcheck Match ' || v_tag, 2)
  RETURNING id INTO v_stage_match;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
  VALUES (v_pipeline, 'HE2E Selfcheck Terminal ' || v_tag, 3, true, 'success')
  RETURNING id INTO v_stage_term;

  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company, 'HE2E Selfcheck Project ' || v_tag, v_owner)
  RETURNING id INTO v_project;

  INSERT INTO he2e_check_ctx (company, owner_user, outsider, pipeline, stage_intake, stage_match, stage_term, project, tag)
  VALUES (v_company, v_owner, v_outsider, v_pipeline, v_stage_intake, v_stage_match, v_stage_term, v_project, v_tag);
END $$;

-- Helper (transactional -- rolls back with everything else): seeds one
-- task_submission + filehub_files/filehub_file_versions (current_version_id
-- set) + submission_attachments row, the exact shape fn_harvest_task_output
-- reads. Same helper shape as check_harvest_rules_rpc.sql's own
-- hrpc_selfcheck_seed_submission, reused across sections 3/5/6/7 here.
CREATE FUNCTION public.he2e_selfcheck_seed_submission(p_task_id uuid, p_company_id uuid, p_actor uuid, p_tag text, p_suffix text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_submission UUID;
  v_file       UUID;
  v_version    UUID;
  v_path       TEXT := 'selfcheck/he2e/' || p_tag || '/' || p_suffix || '.txt';
BEGIN
  INSERT INTO public.task_submissions (task_id, company_id, submitted_by, status, submitted_at)
  VALUES (p_task_id, p_company_id, p_actor, 'pending', now())
  RETURNING id INTO v_submission;

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, task_id)
  VALUES (p_company_id, p_actor, v_path, 'submission-attachments', p_suffix || '.txt', 'text/plain', 5, 'task', p_task_id)
  RETURNING id INTO v_file;

  INSERT INTO public.filehub_file_versions (file_id, company_id, version_no, storage_path, bucket, original_name, size_bytes, mime_type, created_by)
  VALUES (v_file, p_company_id, 1, v_path, 'submission-attachments', p_suffix || '.txt', 5, 'text/plain', p_actor)
  RETURNING id INTO v_version;

  UPDATE public.filehub_files SET current_version_id = v_version WHERE id = v_file;

  INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path, filehub_file_id)
  VALUES (v_submission, p_company_id, p_actor, p_suffix || '.txt', 'https://example.invalid/' || p_suffix, v_path, v_file);
END;
$$;

-- ── 1-2. rpc_create_harvest_rule (real RPC, not a raw INSERT): rule1 ───────
DO $$
DECLARE
  c        RECORD;
  v_rule1  UUID;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  v_rule1 := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', c.stage_match);
  IF v_rule1 IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (2a): rpc_create_harvest_rule returned NULL for rule1';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.harvest_rules
    WHERE id = v_rule1 AND pipeline_id = c.pipeline AND source_stage_id = c.stage_match
      AND condition_type = 'stage_entry' AND destination_folder_id IS NULL AND is_active = true
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (2b): rule1 does not have the expected shape (dynamic destination, active)';
  END IF;

  UPDATE he2e_check_ctx SET tag = tag; -- no-op keepalive (TEMP table already has all fixture ids)
  -- Stash rule1's id where later sections can find it -- a second TEMP
  -- column would work too, but a dedicated table keeps each section's
  -- across-DO-block state next to the section that owns it, matching this
  -- file's per-topic sectioning.
  CREATE TEMP TABLE he2e_rule1 (id UUID);
  INSERT INTO he2e_rule1 VALUES (v_rule1);

  RAISE NOTICE 'OK (1-2): rpc_create_harvest_rule created rule1 (%) as a real stage_entry rule via the RPC surface, not a raw INSERT.', v_rule1;
END $$;

-- ── 3. A REAL stage-move UPDATE fires the trigger; pointer lands correctly ──
DO $$
DECLARE
  c            RECORD;
  v_rule1      UUID;
  v_task1      UUID;
  v_folder     UUID;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT id INTO v_rule1 FROM he2e_rule1;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, created_by)
  VALUES (c.company, 'HE2E Selfcheck Task1 ' || c.tag, c.project, c.pipeline, c.stage_intake, c.owner_user)
  RETURNING id INTO v_task1;

  PERFORM public.he2e_selfcheck_seed_submission(v_task1, c.company, c.owner_user, c.tag, 't1');

  -- THE real trigger path -- an actual UPDATE, not PERFORM fn_harvest_task_output(...).
  UPDATE public.tasks SET current_stage_id = c.stage_match WHERE id = v_task1;

  SELECT deliverable_folder_id INTO v_folder FROM public.projects WHERE id = c.project;
  IF v_folder IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (3a): the stage-move did not lazily create the project''s deliverable folder -- trigger did not fire';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = v_rule1 AND source_task_id = v_task1 AND destination_folder_id = v_folder
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (3b): moving task1 into stage_match via a real UPDATE did not produce the expected harvested_files pointer row for rule1';
  END IF;

  CREATE TEMP TABLE he2e_task1 (id UUID, folder UUID);
  GRANT SELECT ON he2e_task1 TO authenticated;
  INSERT INTO he2e_task1 VALUES (v_task1, v_folder);

  RAISE NOTICE 'OK (3): a real `UPDATE tasks SET current_stage_id` fired the trigger and produced the correct harvested_files pointer (task1 %, folder %).', v_task1, v_folder;
END $$;

-- ── 4. rpc_project_files reflects it ────────────────────────────────────────
DO $$
DECLARE
  c        RECORD;
  t        RECORD;
  v_result JSONB;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT * INTO t FROM he2e_task1;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  v_result := public.rpc_project_files(c.project);
  IF jsonb_array_length(v_result -> 'deliverable_files') <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (4a): rpc_project_files should list exactly 1 deliverable file after step 3, got %', v_result -> 'deliverable_files';
  END IF;
  IF (v_result ->> 'deliverable_folder_id')::uuid IS DISTINCT FROM t.folder THEN
    RAISE EXCEPTION 'CHECK FAILED (4b): rpc_project_files'' deliverable_folder_id (%) does not match the folder the trigger actually harvested into (%)', v_result ->> 'deliverable_folder_id', t.folder;
  END IF;

  RAISE NOTICE 'OK (4): rpc_project_files correctly reflects the harvested file from step 3.';
END $$;

-- ── 5. A SECOND, independent rule (stage_terminal_success) fans out to its
--       OWN destination -- two rules, two results ──────────────────────────
DO $$
DECLARE
  c              RECORD;
  t1             RECORD;
  v_rule2        UUID;
  v_folder2      UUID;
  v_task2        UUID;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT * INTO t1 FROM he2e_task1;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  -- Explicit destination, deliberately DIFFERENT from rule1's dynamic
  -- per-project folder -- same technique check_harvest_rules_rpc.sql's own
  -- section 5 uses: without distinct destinations, harvested_files'
  -- UNIQUE(destination_folder_id, source_file_version_id) plus ON CONFLICT
  -- DO NOTHING would make it impossible to observe BOTH rules actually
  -- firing independently.
  INSERT INTO public.filehub_folders (company_id, name, created_by, scope)
  VALUES (c.company, 'HE2E Selfcheck Rule2 Dest ' || c.tag, c.owner_user, 'broadcast')
  RETURNING id INTO v_folder2;

  -- source_stage_id NULL -- "any success stage on this pipeline".
  v_rule2 := public.rpc_create_harvest_rule(c.pipeline, 'stage_terminal_success', NULL, v_folder2);
  IF v_rule2 IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (5a): rpc_create_harvest_rule returned NULL for rule2';
  END IF;

  INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, created_by)
  VALUES (c.company, 'HE2E Selfcheck Task2 ' || c.tag, c.project, c.pipeline, c.stage_intake, c.owner_user)
  RETURNING id INTO v_task2;
  PERFORM public.he2e_selfcheck_seed_submission(v_task2, c.company, c.owner_user, c.tag, 't2');

  UPDATE public.tasks SET current_stage_id = c.stage_term WHERE id = v_task2;

  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = v_rule2 AND source_task_id = v_task2 AND destination_folder_id = v_folder2
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): rule2 (stage_terminal_success, any success stage) did not fire when task2 entered the terminal-success stage';
  END IF;
  IF v_folder2 = t1.folder THEN
    RAISE EXCEPTION 'CHECK FAILED (5c): fixture invalid -- rule2''s destination must differ from rule1''s to prove independent fan-out';
  END IF;

  -- rule1 must NOT have fired for task2 -- task2 never entered stage_match.
  SELECT id INTO v_rule2 FROM he2e_rule1; -- reuse var, just a lookup
  IF EXISTS (
    SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = (SELECT id FROM he2e_rule1) AND source_task_id = v_task2
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (5d): rule1 incorrectly fired for task2, which never entered stage_match';
  END IF;

  CREATE TEMP TABLE he2e_rule2 (id UUID);
  INSERT INTO he2e_rule2 SELECT id FROM public.harvest_rules WHERE destination_folder_id = v_folder2 AND condition_type = 'stage_terminal_success';

  RAISE NOTICE 'OK (5): rule2 (stage_terminal_success, source_stage_id NULL) fired independently of rule1 and landed in its OWN destination folder % -- fan-out confirmed, two rules, two results.', v_folder2;
END $$;

-- ── 6. rpc_backfill_harvest_rule: picks up a pre-staged task, idempotent ───
DO $$
DECLARE
  c          RECORD;
  v_rule1    UUID;
  v_task3    UUID;
  v_touched  INT;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT id INTO v_rule1 FROM he2e_rule1;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  -- Pre-staged: INSERTED already sitting in stage_match (an INSERT, never an
  -- UPDATE of current_stage_id) -- the trigger (AFTER UPDATE OF
  -- current_stage_id) never fires for it. Exactly the "predates the rule /
  -- moved before backfill" scenario this RPC exists for.
  INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, created_by)
  VALUES (c.company, 'HE2E Selfcheck Task3 Prestaged ' || c.tag, c.project, c.pipeline, c.stage_match, c.owner_user)
  RETURNING id INTO v_task3;
  PERFORM public.he2e_selfcheck_seed_submission(v_task3, c.company, c.owner_user, c.tag, 't3');

  IF EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule1 AND source_task_id = v_task3) THEN
    RAISE EXCEPTION 'CHECK FAILED (6 setup): task3 already has a harvested_files row before backfill ran -- fixture invalid, the pre-staged INSERT must not have fired the trigger';
  END IF;

  v_touched := public.rpc_backfill_harvest_rule(v_rule1);
  -- Exactly 1: task3 is the only task qualifying for rule1 that has no
  -- harvested_files row yet -- task1 (step 3) already has one, so backfill's
  -- own NOT EXISTS excludes it.
  IF v_touched <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (6a): expected backfill to touch exactly 1 task (task3), got %', v_touched;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule1 AND source_task_id = v_task3) THEN
    RAISE EXCEPTION 'CHECK FAILED (6b): backfill ran but task3 has no harvested_files row for rule1';
  END IF;

  -- Idempotent: a second call is a true no-op.
  v_touched := public.rpc_backfill_harvest_rule(v_rule1);
  IF v_touched <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (6c): second backfill call was not idempotent, touched %', v_touched;
  END IF;
  IF (SELECT COUNT(*) FROM public.harvested_files WHERE harvest_rule_id = v_rule1 AND source_task_id = v_task3) <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (6d): second backfill call created a duplicate harvested_files row for task3';
  END IF;

  CREATE TEMP TABLE he2e_task3 (id UUID);
  INSERT INTO he2e_task3 VALUES (v_task3);

  RAISE NOTICE 'OK (6): rpc_backfill_harvest_rule picked up the pre-staged task3 (bypassing the trigger entirely) and was a true no-op on a second call.';
END $$;

-- ── 7. rpc_update_harvest_rule(is_active = false): subsequent moves stop
--       harvesting via rule1 ───────────────────────────────────────────────
DO $$
DECLARE
  c        RECORD;
  v_rule1  UUID;
  v_task4  UUID;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT id INTO v_rule1 FROM he2e_rule1;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  PERFORM public.rpc_update_harvest_rule(v_rule1, NULL, NULL, NULL, NULL, false);
  IF NOT EXISTS (SELECT 1 FROM public.harvest_rules WHERE id = v_rule1 AND is_active = false) THEN
    RAISE EXCEPTION 'CHECK FAILED (7a): rpc_update_harvest_rule(is_active := false) did not persist';
  END IF;

  INSERT INTO public.tasks (company_id, title, project_id, pipeline_id, current_stage_id, created_by)
  VALUES (c.company, 'HE2E Selfcheck Task4 PostDeactivate ' || c.tag, c.project, c.pipeline, c.stage_intake, c.owner_user)
  RETURNING id INTO v_task4;
  PERFORM public.he2e_selfcheck_seed_submission(v_task4, c.company, c.owner_user, c.tag, 't4');

  UPDATE public.tasks SET current_stage_id = c.stage_match WHERE id = v_task4;

  IF EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule1 AND source_task_id = v_task4) THEN
    RAISE EXCEPTION 'CHECK FAILED (7b): task4 entered stage_match after rule1 was deactivated, but a harvested_files row was still created';
  END IF;

  RAISE NOTICE 'OK (7): after rpc_update_harvest_rule(is_active := false), a subsequent stage-move into stage_match no longer harvests via rule1.';
END $$;

-- ── 8. rpc_delete_harvest_rule: rule gone, historical rows survive with
--       harvest_rule_id -> NULL (cascade-fix regression, full-flow context) ─
DO $$
DECLARE
  c            RECORD;
  v_rule1      UUID;
  v_hf_count_before INT;
  v_hf_count_after  INT;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT id INTO v_rule1 FROM he2e_rule1;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  -- rule1 produced 2 rows across the flow so far: task1 (step 3) and task3
  -- (step 6's backfill). task4 (step 7) correctly produced none.
  SELECT COUNT(*) INTO v_hf_count_before FROM public.harvested_files WHERE harvest_rule_id = v_rule1;
  IF v_hf_count_before <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (8 setup): expected rule1 to have exactly 2 harvested_files rows before deletion (task1 + task3), got %', v_hf_count_before;
  END IF;

  PERFORM public.rpc_delete_harvest_rule(v_rule1);

  IF EXISTS (SELECT 1 FROM public.harvest_rules WHERE id = v_rule1) THEN
    RAISE EXCEPTION 'CHECK FAILED (8a): harvest_rules row still exists after rpc_delete_harvest_rule';
  END IF;

  SELECT COUNT(*) INTO v_hf_count_after FROM public.harvested_files WHERE harvest_rule_id IS NULL AND destination_folder_id IN (
    SELECT deliverable_folder_id FROM public.projects WHERE id = c.project
  );
  IF v_hf_count_after <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (8b) [CASCADE REGRESSION]: expected both of rule1''s historical harvested_files rows to survive with harvest_rule_id set to NULL, found %', v_hf_count_after;
  END IF;

  RAISE NOTICE 'OK (8): rpc_delete_harvest_rule removed rule1''s configuration but both historical harvested_files rows it produced survive with harvest_rule_id set to NULL -- the cascade fix holds in the full end-to-end flow.';
END $$;

-- ── 9a. Access control: a same-company user without pipeline.edit/is_owner
--        cannot call any of the 4 rule-authoring RPCs ──────────────────────
DO $$
DECLARE
  c        RECORD;
  v_rule2  UUID;
  v_raised BOOLEAN;
  v_msg    TEXT;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT id INTO v_rule2 FROM he2e_rule2;
  PERFORM set_config('request.jwt.claim.sub', c.outsider::text, true);

  v_raised := false;
  BEGIN
    PERFORM public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', c.stage_match);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised OR v_msg NOT ILIKE '%Insufficient permissions%' THEN
    RAISE EXCEPTION 'CHECK FAILED (9a-create): outsider (project.view only, no pipeline.edit) was able to call rpc_create_harvest_rule, or got an unexpected error: %', v_msg;
  END IF;

  v_raised := false;
  BEGIN
    PERFORM public.rpc_update_harvest_rule(v_rule2, NULL, NULL, NULL, NULL, false);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised OR v_msg NOT ILIKE '%Insufficient permissions%' THEN
    RAISE EXCEPTION 'CHECK FAILED (9a-update): outsider was able to call rpc_update_harvest_rule, or got an unexpected error: %', v_msg;
  END IF;

  v_raised := false;
  BEGIN
    PERFORM public.rpc_backfill_harvest_rule(v_rule2);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised OR v_msg NOT ILIKE '%Insufficient permissions%' THEN
    RAISE EXCEPTION 'CHECK FAILED (9a-backfill): outsider was able to call rpc_backfill_harvest_rule, or got an unexpected error: %', v_msg;
  END IF;

  v_raised := false;
  BEGIN
    PERFORM public.rpc_delete_harvest_rule(v_rule2);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised OR v_msg NOT ILIKE '%Insufficient permissions%' THEN
    RAISE EXCEPTION 'CHECK FAILED (9a-delete): outsider was able to call rpc_delete_harvest_rule, or got an unexpected error: %', v_msg;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.harvest_rules WHERE id = v_rule2) THEN
    RAISE EXCEPTION 'CHECK FAILED (9a sanity): rule2 must still exist -- every call above should have been rejected before mutating anything';
  END IF;

  RAISE NOTICE 'OK (9a): a same-company user with project.view but neither is_owner nor pipeline.edit is denied on all 4 rule-authoring RPCs against this pipeline.';
END $$;

-- ── 9b. Access control: a user without access to THIS project cannot see
--        the harvested content via rpc_project_files or harvested_files RLS,
--        even though they generally hold project.view ─────────────────────
DO $$
DECLARE
  c        RECORD;
  v_raised BOOLEAN := false;
  v_msg    TEXT;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.outsider::text, true);

  BEGIN
    PERFORM public.rpc_project_files(c.project);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (9b-rpc): rpc_project_files returned data to an outsider with no access to this specific project';
  END IF;
  IF v_msg IS DISTINCT FROM 'Project not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (9b-rpc): expected "Project not found." (outsider has project.view but no assignment/ownership on THIS project), got: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (9b, part 1): rpc_project_files denies an outsider who holds project.view generally but has no access to this specific project ("Project not found.", not a widened result).';
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c    RECORD;
  t1   RECORD;
  v_ok BOOLEAN;
BEGIN
  SELECT * INTO c FROM he2e_check_ctx;
  SELECT * INTO t1 FROM he2e_task1;

  -- Direct RLS check on the destination folder produced by step 3, whose
  -- harvest_rule_id is now NULL (step 8's cascade-fix rows) -- proves the
  -- RLS policy composes on filehub_folder_accessible(destination_folder_id)
  -- and still gates correctly with the rule link gone, not on harvest_rule_id.
  PERFORM set_config('request.jwt.claim.sub', c.outsider::text, true);
  SELECT EXISTS(SELECT 1 FROM public.harvested_files WHERE destination_folder_id = t1.folder) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (9b-rls-outsider): outsider (no access to this project) can read harvested_files rows for its deliverable folder via RLS';
  END IF;

  -- Sanity: the owner (who legitimately owns the project) still sees them
  -- post-delete -- proves 9b-rls-outsider is a real access denial, not RLS
  -- broken for everyone after the cascade-fix NULLed harvest_rule_id.
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);
  SELECT EXISTS(SELECT 1 FROM public.harvested_files WHERE destination_folder_id = t1.folder) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (9b-rls-owner): the project owner can no longer see harvested_files rows for their own deliverable folder after harvest_rule_id was NULLed -- RLS regressed for everyone, not just outsiders';
  END IF;

  RAISE NOTICE 'OK (9b, part 2): harvested_files RLS denies an outsider with no project access (even post-delete, harvest_rule_id NULL) while the legitimate project owner still sees the same rows.';
END $$;

RESET ROLE;

DO $$ BEGIN
  RAISE NOTICE 'ALL CHECKS PASSED: issue #284 end-to-end -- rule creation via the real RPC surface, a real trigger-fired stage move, rpc_project_files, independent two-rule fan-out, backfill (bounded + idempotent), update deactivation, delete + the cascade-fix survival guard, and access control (pipeline-edit gate on all 4 RPCs, project-access gate on rpc_project_files + harvested_files RLS) all hold as ONE continuous scenario.';
END $$;

ROLLBACK;
