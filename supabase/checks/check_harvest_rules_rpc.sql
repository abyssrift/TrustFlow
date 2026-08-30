-- Runnable check for issue #284, Phase 3: harvest rule CRUD RPCs,
-- stage_terminal_success, backfill, and the cascade-fix regression guard.
-- Phase 5 (sections 6-7 below): rpc_delete_stage's automation/harvest-rule
-- reference guard, and the read-only rpc_count_harvest_rule_backlog RPC.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_harvest_rules_rpc.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates one throwaway pipeline/stages/project in
-- an existing seeded company (reusing real users, same convention as
-- check_project_deliverable.sql and check_harvest_rules_schema.sql), always
-- rolls back, safe to re-run. All 4 rule-authoring RPCs are SECURITY DEFINER
-- and their permission gates (is_owner/has_permission) read auth.uid(),
-- which is purely GUC-based (auth.uid() = current_setting
-- ('request.jwt.claim.sub')) -- deliberately NOT running this whole check
-- under `SET LOCAL ROLE authenticated`, unlike the RLS-focused checks this
-- one is modeled on: harvest_rules'/harvested_files' own SELECT policies
-- would then filter THIS CHECK'S OWN assertion queries by the impersonated
-- user's pipeline visibility (a real RLS behaviour, but orthogonal to what
-- this file tests -- that's check_harvest_rules_schema.sql's job). Staying
-- as postgres for every plain SELECT/assertion and only swapping
-- request.jwt.claim.sub around each RPC call gets real permission-gate
-- testing without that false-negative trap.
--
-- What it proves:
--   1. rpc_create_harvest_rule: denies a user with neither is_owner nor
--      pipeline.edit; rejects an invalid condition_type and a stage_entry
--      rule with no source_stage_id (both with a clean RAISE EXCEPTION, not
--      a raw constraint violation); rejects a source_stage_id that belongs
--      to a DIFFERENT pipeline; succeeds for a pipeline.edit-holding user.
--   2. rpc_update_harvest_rule: COALESCE partial update -- changing one
--      field leaves the others untouched.
--   3. rpc_delete_harvest_rule + the cascade-fix regression test: a rule
--      with existing harvested_files rows, once deleted, leaves those rows
--      intact with harvest_rule_id now NULL rather than deleting them (the
--      actual point of 20260821_harvest_rule_cascade_fix.sql).
--   4. rpc_backfill_harvest_rule: harvests exactly the tasks that already
--      sit in the qualifying stage (never having gone through the trigger,
--      since they were inserted pre-positioned, not moved there) and is a
--      true no-op on a second call (0 touched, no duplicate rows).
--   5. stage_terminal_success fires via the trigger in both forms: pinned
--      to one specific terminal-success stage, and source_stage_id IS NULL
--      matching ANY terminal-success stage on the pipeline -- and a pinned
--      rule does NOT fire for a different terminal-success stage it isn't
--      pinned to.

BEGIN;

CREATE TEMP TABLE hrpc_check_ctx (
  company        UUID,
  creator        UUID,
  u_editor       UUID,  -- granted pipeline.edit, no is_owner
  u_plain        UUID,  -- neither is_owner nor pipeline.edit
  pipeline       UUID,
  other_pipeline UUID,
  stage_source   UUID,
  stage_target   UUID,
  stage_other    UUID,  -- belongs to other_pipeline
  stage_term_a   UUID,  -- terminal, success
  stage_term_b   UUID,  -- terminal, success (distinct from stage_term_a)
  project        UUID,
  tag            TEXT
);

-- ── Fixture setup (runs as postgres -- bypasses RLS) ────────────────────────
DO $$
DECLARE
  v_company        UUID;
  v_creator        UUID;
  v_pool           UUID[];
  v_pipeline       UUID;
  v_other_pipeline UUID;
  v_stage_source   UUID;
  v_stage_target   UUID;
  v_stage_other    UUID;
  v_stage_term_a   UUID;
  v_stage_term_b   UUID;
  v_project        UUID;
  v_tag            TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  SELECT p.company_id, p.id
  INTO v_company, v_pipeline
  FROM public.pipelines p
  WHERE p.deleted_at IS NULL
  GROUP BY p.company_id, p.id
  HAVING (SELECT COUNT(*) FROM public.pipeline_stages s WHERE s.pipeline_id = p.id) >= 1
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No company with a pipeline+stage found -- seed data required.';
  END IF;

  SELECT id INTO v_creator FROM public.users WHERE company_id = v_company AND is_owner = true LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No owner user found for company %.', v_company;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT id FROM public.users WHERE company_id = v_company AND is_owner = false ORDER BY id LIMIT 2
  ) x;
  IF v_pool IS NULL OR array_length(v_pool, 1) < 2 THEN
    RAISE EXCEPTION 'Need 2 distinct non-owner users in company % -- seed data too thin.', v_company;
  END IF;

  -- u_editor (v_pool[1]) gets pipeline.edit -- proves the RPCs accept the
  -- permission-based path, not just is_owner. u_plain (v_pool[2]) gets
  -- nothing -- proves the denial path.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, p.id
  FROM public.user_roles ur
  JOIN public.permissions p ON p.key = 'pipeline.edit'
  WHERE ur.user_id = v_pool[1] AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.pipelines (company_id, name, subject_kind, created_by)
  VALUES (v_company, 'HRPC Selfcheck Other Pipeline ' || v_tag, 'task', v_creator)
  RETURNING id INTO v_other_pipeline;

  SELECT id INTO v_stage_source FROM public.pipeline_stages WHERE pipeline_id = v_pipeline LIMIT 1;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_pipeline, 'HRPC Selfcheck Target ' || v_tag, 900)
  RETURNING id INTO v_stage_target;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
  VALUES (v_pipeline, 'HRPC Selfcheck Term A ' || v_tag, 901, true, 'success')
  RETURNING id INTO v_stage_term_a;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
  VALUES (v_pipeline, 'HRPC Selfcheck Term B ' || v_tag, 902, true, 'success')
  RETURNING id INTO v_stage_term_b;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (v_other_pipeline, 'HRPC Selfcheck Cross-pipeline Stage ' || v_tag, 1)
  RETURNING id INTO v_stage_other;

  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company, 'HRPC Selfcheck Project ' || v_tag, v_creator)
  RETURNING id INTO v_project;

  INSERT INTO hrpc_check_ctx (
    company, creator, u_editor, u_plain, pipeline, other_pipeline,
    stage_source, stage_target, stage_other, stage_term_a, stage_term_b, project, tag
  ) VALUES (
    v_company, v_creator, v_pool[1], v_pool[2], v_pipeline, v_other_pipeline,
    v_stage_source, v_stage_target, v_stage_other, v_stage_term_a, v_stage_term_b, v_project, v_tag
  );
END $$;

-- Helper (transactional DDL -- rolls back with everything else): seeds one
-- task_submission + filehub_files/filehub_file_versions (current_version_id
-- set) + submission_attachments row, the exact shape fn_harvest_task_output
-- reads. Reused by sections 4 and 5 to avoid repeating this 4-insert block
-- per task.
CREATE FUNCTION public.hrpc_selfcheck_seed_submission(p_task_id uuid, p_company_id uuid, p_actor uuid, p_tag text, p_suffix text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_submission UUID;
  v_file       UUID;
  v_version    UUID;
  v_path       TEXT := 'selfcheck/hrpc/' || p_tag || '/' || p_suffix || '.txt';
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

-- ── 1. rpc_create_harvest_rule: permission gate + validation ───────────────
DO $$
DECLARE
  c        RECORD;
  v_raised BOOLEAN;
  v_msg    TEXT;
  v_rule   UUID;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;

  -- 1a. u_plain (neither is_owner nor pipeline.edit) is denied.
  PERFORM set_config('request.jwt.claim.sub', c.u_plain::text, true);
  v_raised := false;
  BEGIN
    PERFORM public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', c.stage_target);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): u_plain (no permission) was able to create a harvest rule';
  END IF;
  IF v_msg NOT ILIKE '%Insufficient permissions%' THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): expected an Insufficient permissions error, got: %', v_msg;
  END IF;

  -- From here on, act as u_editor (pipeline.edit, no is_owner).
  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);

  -- 1b. Invalid condition_type is rejected with a clean error.
  v_raised := false;
  BEGIN
    PERFORM public.rpc_create_harvest_rule(c.pipeline, 'field_equals', c.stage_target);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): rpc_create_harvest_rule accepted condition_type=''field_equals''';
  END IF;
  IF v_msg NOT ILIKE '%Invalid condition type%' THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): expected an Invalid condition type error, got: %', v_msg;
  END IF;

  -- 1c. stage_entry with no source_stage_id is rejected.
  v_raised := false;
  BEGIN
    PERFORM public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', NULL);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): rpc_create_harvest_rule accepted stage_entry with no source_stage_id';
  END IF;
  IF v_msg NOT ILIKE '%require a source stage%' THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): expected a require-a-source-stage error, got: %', v_msg;
  END IF;

  -- 1d. source_stage_id from a DIFFERENT pipeline is rejected.
  v_raised := false;
  BEGIN
    PERFORM public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', c.stage_other);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (1d): rpc_create_harvest_rule accepted a source_stage_id from a different pipeline';
  END IF;
  IF v_msg NOT ILIKE '%does not belong to this pipeline%' THEN
    RAISE EXCEPTION 'CHECK FAILED (1d): expected a does-not-belong-to-pipeline error, got: %', v_msg;
  END IF;

  -- 1e. A valid call by u_editor (permission path, not is_owner) succeeds.
  v_rule := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', c.stage_target, NULL, 45);
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1e): rpc_create_harvest_rule returned NULL for a valid call';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.harvest_rules
    WHERE id = v_rule AND pipeline_id = c.pipeline AND source_stage_id = c.stage_target
      AND condition_type = 'stage_entry' AND check_interval_minutes = 45 AND is_active = true
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (1e): created rule does not have the expected shape';
  END IF;

  RAISE NOTICE 'OK (1): permission gate denies u_plain, condition_type/source_stage_id are validated with clean errors, u_editor (permission path) can create a rule (%).', v_rule;
END $$;

-- ── 2. rpc_update_harvest_rule: COALESCE partial update ────────────────────
DO $$
DECLARE
  c      RECORD;
  v_rule UUID;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);

  v_rule := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', c.stage_target, NULL, 60);

  -- Only touch check_interval_minutes -- condition_type/source_stage_id/is_active must survive untouched.
  PERFORM public.rpc_update_harvest_rule(v_rule, NULL, NULL, NULL, 15, NULL);
  IF NOT EXISTS (
    SELECT 1 FROM public.harvest_rules
    WHERE id = v_rule AND check_interval_minutes = 15
      AND condition_type = 'stage_entry' AND source_stage_id = c.stage_target AND is_active = true
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (2a): partial update of check_interval_minutes touched other columns or did not apply';
  END IF;

  -- Now only touch is_active -- check_interval_minutes must stay at 15.
  PERFORM public.rpc_update_harvest_rule(v_rule, NULL, NULL, NULL, NULL, false);
  IF NOT EXISTS (
    SELECT 1 FROM public.harvest_rules WHERE id = v_rule AND is_active = false AND check_interval_minutes = 15
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (2b): partial update of is_active touched check_interval_minutes or did not apply';
  END IF;

  RAISE NOTICE 'OK (2): rpc_update_harvest_rule COALESCE-updates only the fields passed, leaving the rest untouched.';
END $$;

-- ── 3. rpc_delete_harvest_rule + the cascade-fix regression test ───────────
DO $$
DECLARE
  c              RECORD;
  v_stage_target UUID;
  v_rule         UUID;
  v_task         UUID;
  v_submission   UUID;
  v_file         UUID;
  v_version      UUID;
  v_hf_id        UUID;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;

  -- A stage of its own, NOT c.stage_target -- sections 1/2 already created
  -- (and left active) stage_entry rules pinned to c.stage_target. Reusing it
  -- here would fan this section's task out to THOSE rules too, and since
  -- they all resolve to the SAME per-project dynamic destination folder,
  -- whichever rule's insert wins the UNIQUE(destination_folder_id,
  -- source_file_version_id) race would silently starve this section's own
  -- rule via ON CONFLICT DO NOTHING -- a fixture collision, not a product bug.
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Delete-regression Target ' || c.tag, 903)
  RETURNING id INTO v_stage_target;

  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);
  v_rule := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', v_stage_target, NULL, 60);

  -- Harvest one real file into it.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Delete-regression Task ' || c.tag, c.creator, c.pipeline, c.project, c.stage_source)
  RETURNING id INTO v_task;

  INSERT INTO public.task_submissions (task_id, company_id, submitted_by, status, submitted_at)
  VALUES (v_task, c.company, c.creator, 'pending', now())
  RETURNING id INTO v_submission;

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, task_id)
  VALUES (c.company, c.creator, 'selfcheck/hrpc/' || c.tag || '/del.txt', 'submission-attachments', 'del.txt', 'text/plain', 5, 'task', v_task)
  RETURNING id INTO v_file;

  INSERT INTO public.filehub_file_versions (file_id, company_id, version_no, storage_path, bucket, original_name, size_bytes, mime_type, created_by)
  VALUES (v_file, c.company, 1, 'selfcheck/hrpc/' || c.tag || '/del.txt', 'submission-attachments', 'del.txt', 5, 'text/plain', c.creator)
  RETURNING id INTO v_version;

  UPDATE public.filehub_files SET current_version_id = v_version WHERE id = v_file;

  INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path, filehub_file_id)
  VALUES (v_submission, c.company, c.creator, 'del.txt', 'https://example.invalid/del', 'selfcheck/hrpc/' || c.tag || '/del.txt', v_file);

  UPDATE public.tasks SET current_stage_id = v_stage_target WHERE id = v_task;

  SELECT id INTO v_hf_id FROM public.harvested_files WHERE harvest_rule_id = v_rule AND source_task_id = v_task;
  IF v_hf_id IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (3 setup): moving the task into the target stage did not harvest a file -- fixture invalid';
  END IF;

  PERFORM public.rpc_delete_harvest_rule(v_rule);

  IF EXISTS (SELECT 1 FROM public.harvest_rules WHERE id = v_rule) THEN
    RAISE EXCEPTION 'CHECK FAILED (3a): harvest_rules row still exists after rpc_delete_harvest_rule';
  END IF;

  -- THE regression test for the cascade fix: the harvested_files row must
  -- survive the rule's deletion, with harvest_rule_id now NULL -- not
  -- CASCADE-deleted alongside it.
  IF NOT EXISTS (SELECT 1 FROM public.harvested_files WHERE id = v_hf_id AND harvest_rule_id IS NULL) THEN
    RAISE EXCEPTION 'CHECK FAILED (3b) [CASCADE REGRESSION]: harvested_files row % did not survive rule deletion with harvest_rule_id set to NULL -- the cascade fix regressed', v_hf_id;
  END IF;

  RAISE NOTICE 'OK (3): rpc_delete_harvest_rule hard-deletes the rule (mirrors rpc_delete_automation); the harvested_files row % it produced survives with harvest_rule_id set to NULL.', v_hf_id;
END $$;

-- ── 4. rpc_backfill_harvest_rule: bounded, exact, idempotent ───────────────
DO $$
DECLARE
  c              RECORD;
  v_rule         UUID;
  v_task_qual1   UUID;
  v_task_qual2   UUID;
  v_task_already UUID;
  v_touched      INT;
  v_hf_count     INT;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;

  -- Two tasks INSERTED already sitting in stage_target (never moved there by
  -- UPDATE, so the trigger never fired for them -- exactly the "predates the
  -- rule" scenario backfill exists for), each with one harvestable file.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Backfill Qual1 ' || c.tag, c.creator, c.pipeline, c.project, c.stage_target)
  RETURNING id INTO v_task_qual1;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Backfill Qual2 ' || c.tag, c.creator, c.pipeline, c.project, c.stage_target)
  RETURNING id INTO v_task_qual2;
  -- A third task in a DIFFERENT stage -- must NOT be touched by backfill.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Backfill NotQualifying ' || c.tag, c.creator, c.pipeline, c.project, c.stage_source)
  RETURNING id INTO v_task_already;

  PERFORM public.hrpc_selfcheck_seed_submission(v_task_qual1, c.company, c.creator, c.tag, 'bf1');
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_qual2, c.company, c.creator, c.tag, 'bf2');
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_already, c.company, c.creator, c.tag, 'bf3');

  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);
  v_rule := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', c.stage_target, NULL, 60);

  v_touched := public.rpc_backfill_harvest_rule(v_rule);
  IF v_touched <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4a): expected exactly 2 qualifying tasks touched, got %', v_touched;
  END IF;

  SELECT COUNT(*) INTO v_hf_count FROM public.harvested_files WHERE harvest_rule_id = v_rule;
  IF v_hf_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4b): expected exactly 2 harvested_files rows after backfill, got %', v_hf_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule AND source_task_id = v_task_already) THEN
    RAISE EXCEPTION 'CHECK FAILED (4c): backfill harvested a task that was never in the qualifying stage';
  END IF;

  -- Idempotent: a second call must be a true no-op -- both tasks now already
  -- have a harvested_files row for this rule, so NOT EXISTS excludes them.
  v_touched := public.rpc_backfill_harvest_rule(v_rule);
  IF v_touched <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (4d): second backfill call was not a no-op, touched %', v_touched;
  END IF;
  SELECT COUNT(*) INTO v_hf_count FROM public.harvested_files WHERE harvest_rule_id = v_rule;
  IF v_hf_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4e): second backfill call created duplicate harvested_files rows, now %', v_hf_count;
  END IF;

  RAISE NOTICE 'OK (4): rpc_backfill_harvest_rule harvested exactly the 2 pre-positioned qualifying tasks (not the non-qualifying one) and was a true no-op on a second call.';
END $$;

-- ── 5. stage_terminal_success: pinned form + any-terminal-stage form ───────
DO $$
DECLARE
  c               RECORD;
  v_folder_pinned UUID;
  v_rule_pinned   UUID;
  v_rule_any      UUID;
  v_task_a        UUID;
  v_task_b        UUID;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;

  -- v_rule_pinned gets its OWN explicit destination folder, distinct from
  -- v_rule_any's dynamic per-project fallback. Both otherwise resolve to the
  -- SAME destination for task_a's file (the project's one deliverable
  -- folder) -- and harvested_files' UNIQUE(destination_folder_id,
  -- source_file_version_id) means whichever rule's insert wins that race is
  -- the only row that exists, silently starving the other via ON CONFLICT
  -- DO NOTHING. That's correct dedup behaviour for two rules genuinely
  -- funnelling to the same place, but it would make this test unable to
  -- observe BOTH rules actually firing -- so give them different
  -- destinations, the same technique check_project_deliverable.sql's own
  -- fan-out test uses.
  INSERT INTO public.filehub_folders (company_id, name, created_by, scope)
  VALUES (c.company, 'HRPC Selfcheck Pinned Dest ' || c.tag, c.creator, 'broadcast')
  RETURNING id INTO v_folder_pinned;

  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);
  -- Pinned: only fires for stage_term_a.
  v_rule_pinned := public.rpc_create_harvest_rule(c.pipeline, 'stage_terminal_success', c.stage_term_a, v_folder_pinned, 60);
  -- Any: source_stage_id NULL -- must fire for EITHER terminal-success stage.
  v_rule_any := public.rpc_create_harvest_rule(c.pipeline, 'stage_terminal_success', NULL, NULL, 60);

  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Terminal A ' || c.tag, c.creator, c.pipeline, c.project, c.stage_source)
  RETURNING id INTO v_task_a;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Terminal B ' || c.tag, c.creator, c.pipeline, c.project, c.stage_source)
  RETURNING id INTO v_task_b;

  PERFORM public.hrpc_selfcheck_seed_submission(v_task_a, c.company, c.creator, c.tag, 'terma');
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_b, c.company, c.creator, c.tag, 'termb');

  -- task_a enters stage_term_a: BOTH rules should fire.
  UPDATE public.tasks SET current_stage_id = c.stage_term_a WHERE id = v_task_a;
  IF NOT EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_pinned AND source_task_id = v_task_a) THEN
    RAISE EXCEPTION 'CHECK FAILED (5a): the rule pinned to stage_term_a did not fire when a task entered stage_term_a';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_any AND source_task_id = v_task_a) THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): the any-terminal-stage rule (source_stage_id NULL) did not fire when a task entered stage_term_a';
  END IF;

  -- task_b enters stage_term_b: only the any-rule should fire; the pinned
  -- rule must NOT fire (it is not that stage).
  UPDATE public.tasks SET current_stage_id = c.stage_term_b WHERE id = v_task_b;
  IF EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_pinned AND source_task_id = v_task_b) THEN
    RAISE EXCEPTION 'CHECK FAILED (5c): the rule pinned to stage_term_a incorrectly fired for a task entering stage_term_b';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_any AND source_task_id = v_task_b) THEN
    RAISE EXCEPTION 'CHECK FAILED (5d): the any-terminal-stage rule did not fire when a task entered stage_term_b';
  END IF;

  RAISE NOTICE 'OK (5): stage_terminal_success fires correctly for both the pinned-to-one-stage form and the source_stage_id IS NULL any-terminal-stage form, and a pinned rule correctly ignores a different terminal-success stage.';
END $$;

-- ── 6. rpc_delete_stage: automation/harvest-rule reference guard (Phase 5) ─
DO $$
DECLARE
  c                RECORD;
  v_stage_both     UUID;  -- referenced by 1 automation + 1 harvest rule
  v_stage_auto2    UUID;  -- referenced by 2 automations, 0 harvest rules
  v_stage_harvest1 UUID;  -- referenced by 0 automations, 1 harvest rule
  v_stage_unrelated UUID; -- referenced by nothing (tests 6e)
  v_auto_both      UUID;
  v_auto_a         UUID;
  v_auto_b         UUID;
  v_rule_both      UUID;
  v_rule_harvest1  UUID;
  v_raised         BOOLEAN;
  v_msg            TEXT;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Guard Both ' || c.tag, 910) RETURNING id INTO v_stage_both;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Guard Auto2 ' || c.tag, 911) RETURNING id INTO v_stage_auto2;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Guard Harvest1 ' || c.tag, 912) RETURNING id INTO v_stage_harvest1;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Guard Unrelated ' || c.tag, 913) RETURNING id INTO v_stage_unrelated;

  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);

  -- 6a. One automation + one harvest rule reference v_stage_both -- blocked,
  -- message names both, correctly pluralized (1 each), pronoun "them" since
  -- the combined total is 2.
  INSERT INTO public.pipeline_automations (pipeline_id, source_stage_id, target_stage_id, condition_type, company_id)
  VALUES (c.pipeline, v_stage_both, c.stage_source, 'overdue', c.company)
  RETURNING id INTO v_auto_both;
  v_rule_both := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', v_stage_both, NULL, 60);

  v_raised := false;
  BEGIN
    PERFORM public.rpc_delete_stage(v_stage_both);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (6a): rpc_delete_stage deleted a stage still referenced by an automation and a harvest rule';
  END IF;
  IF v_msg <> 'Cannot delete stage: referenced by 1 automation and 1 harvest rule. Remove or repoint them first.' THEN
    RAISE EXCEPTION 'CHECK FAILED (6a): unexpected message: %', v_msg;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id = v_stage_both) THEN
    RAISE EXCEPTION 'CHECK FAILED (6a): stage was deleted despite the guard raising';
  END IF;

  -- 6b. Two automations only (0 harvest rules) -- "2 automations", pronoun
  -- "them" (total 2). v_stage_auto2 is source on one, target on the other --
  -- proves the guard counts EITHER column, not just source_stage_id.
  INSERT INTO public.pipeline_automations (pipeline_id, source_stage_id, target_stage_id, condition_type, company_id)
  VALUES (c.pipeline, v_stage_auto2, c.stage_source, 'overdue', c.company) RETURNING id INTO v_auto_a;
  INSERT INTO public.pipeline_automations (pipeline_id, source_stage_id, target_stage_id, condition_type, company_id)
  VALUES (c.pipeline, c.stage_source, v_stage_auto2, 'overdue', c.company) RETURNING id INTO v_auto_b;

  v_raised := false;
  BEGIN
    PERFORM public.rpc_delete_stage(v_stage_auto2);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (6b): rpc_delete_stage deleted a stage referenced (as source AND as target) by 2 automations';
  END IF;
  IF v_msg <> 'Cannot delete stage: referenced by 2 automations. Remove or repoint them first.' THEN
    RAISE EXCEPTION 'CHECK FAILED (6b): unexpected message: %', v_msg;
  END IF;

  -- 6c. One harvest rule only (0 automations) -- "1 harvest rule", pronoun
  -- "it" (total 1).
  v_rule_harvest1 := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', v_stage_harvest1, NULL, 60);

  v_raised := false;
  BEGIN
    PERFORM public.rpc_delete_stage(v_stage_harvest1);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (6c): rpc_delete_stage deleted a stage still referenced by a harvest rule';
  END IF;
  IF v_msg <> 'Cannot delete stage: referenced by 1 harvest rule. Remove or repoint it first.' THEN
    RAISE EXCEPTION 'CHECK FAILED (6c): unexpected message: %', v_msg;
  END IF;

  -- 6d. Once the references are removed, deletion succeeds.
  DELETE FROM public.pipeline_automations WHERE id = v_auto_both;
  PERFORM public.rpc_delete_harvest_rule(v_rule_both);
  PERFORM public.rpc_delete_stage(v_stage_both);
  IF EXISTS (SELECT 1 FROM public.pipeline_stages WHERE id = v_stage_both) THEN
    RAISE EXCEPTION 'CHECK FAILED (6d): rpc_delete_stage did not delete the stage once its references were removed';
  END IF;

  -- 6e. A harvest rule with source_stage_id IS NULL ("any stage", created in
  -- section 5 as v_rule_any) does NOT block deletion of an unrelated stage
  -- that nothing directly references -- NULL never equals p_stage_id.
  IF NOT EXISTS (SELECT 1 FROM public.harvest_rules WHERE pipeline_id = c.pipeline AND source_stage_id IS NULL) THEN
    RAISE EXCEPTION 'CHECK FAILED (6e setup): expected an "any stage" (source_stage_id IS NULL) harvest rule from section 5 to still exist';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.rpc_delete_stage(v_stage_unrelated);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (6e): rpc_delete_stage blocked an unrelated stage''s deletion (got: %) -- an "any stage" harvest rule must not count as referencing every stage', v_msg;
  END IF;

  RAISE NOTICE 'OK (6): rpc_delete_stage blocks with correctly pluralized messages when an automation and/or harvest rule reference the stage (both/automations-only/harvest-only), succeeds once references are removed, and a source_stage_id IS NULL harvest rule does not block an unrelated stage.';
END $$;

-- ── 7. rpc_count_harvest_rule_backlog: matches backfill, mutates nothing ───
DO $$
DECLARE
  c              RECORD;
  v_stage        UUID;
  v_rule         UUID;
  v_task_qual1   UUID;
  v_task_qual2   UUID;
  v_task_other   UUID;
  v_count        INT;
  v_hf_before    INT;
  v_hf_after     INT;
  v_touched      INT;
  v_raised       BOOLEAN;
  v_msg          TEXT;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Backlog Count Stage ' || c.tag, 914) RETURNING id INTO v_stage;

  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Count Qual1 ' || c.tag, c.creator, c.pipeline, c.project, v_stage)
  RETURNING id INTO v_task_qual1;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Count Qual2 ' || c.tag, c.creator, c.pipeline, c.project, v_stage)
  RETURNING id INTO v_task_qual2;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Count NotQualifying ' || c.tag, c.creator, c.pipeline, c.project, c.stage_source)
  RETURNING id INTO v_task_other;

  PERFORM public.hrpc_selfcheck_seed_submission(v_task_qual1, c.company, c.creator, c.tag, 'cnt1');
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_qual2, c.company, c.creator, c.tag, 'cnt2');
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_other, c.company, c.creator, c.tag, 'cnt3');

  -- 7a. u_plain (no permission) is denied -- same gate as the other 4 RPCs.
  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);
  v_rule := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', v_stage, NULL, 60);

  PERFORM set_config('request.jwt.claim.sub', c.u_plain::text, true);
  v_raised := false;
  BEGIN
    PERFORM public.rpc_count_harvest_rule_backlog(v_rule);
    v_raised := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'CHECK FAILED (7a): u_plain (no permission) was able to call rpc_count_harvest_rule_backlog';
  END IF;
  IF v_msg NOT ILIKE '%Insufficient permissions%' THEN
    RAISE EXCEPTION 'CHECK FAILED (7a): expected an Insufficient permissions error, got: %', v_msg;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);

  -- 7b. Count says exactly 2 (the qualifying pair, not the non-qualifying task).
  SELECT public.rpc_count_harvest_rule_backlog(v_rule) INTO v_count;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (7b): expected backlog count 2, got %', v_count;
  END IF;

  -- 7c. Calling the count RPC mutates nothing -- harvested_files count for
  -- this rule is identical before and after (unlike backfill, which would
  -- create rows).
  SELECT COUNT(*) INTO v_hf_before FROM public.harvested_files WHERE harvest_rule_id = v_rule;
  PERFORM public.rpc_count_harvest_rule_backlog(v_rule);
  PERFORM public.rpc_count_harvest_rule_backlog(v_rule);
  SELECT COUNT(*) INTO v_hf_after FROM public.harvested_files WHERE harvest_rule_id = v_rule;
  IF v_hf_before <> 0 OR v_hf_after <> 0 OR v_hf_before <> v_hf_after THEN
    RAISE EXCEPTION 'CHECK FAILED (7c): rpc_count_harvest_rule_backlog mutated harvested_files (before=%, after=%)', v_hf_before, v_hf_after;
  END IF;

  -- 7d. Calling backfill now touches exactly the same 2 tasks the count
  -- predicted -- not more, not fewer.
  v_touched := public.rpc_backfill_harvest_rule(v_rule);
  IF v_touched <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (7d): expected backfill to touch exactly the 2 tasks the count RPC predicted, touched %', v_touched;
  END IF;
  IF EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule AND source_task_id = v_task_other) THEN
    RAISE EXCEPTION 'CHECK FAILED (7d): backfill touched the non-qualifying task the count RPC correctly excluded';
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule AND source_task_id = v_task_qual1)
    AND EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule AND source_task_id = v_task_qual2)
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (7d): backfill did not touch both tasks the count RPC predicted';
  END IF;

  -- 7e. After backfill, the count drops to 0 -- same idempotency the NOT
  -- EXISTS clause gives backfill itself.
  SELECT public.rpc_count_harvest_rule_backlog(v_rule) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (7e): expected backlog count 0 after backfill drained it, got %', v_count;
  END IF;

  RAISE NOTICE 'OK (7): rpc_count_harvest_rule_backlog denies u_plain, returns exactly the qualifying count (2), mutates nothing (harvested_files unchanged across repeated calls), matches exactly what backfill then touches, and drops to 0 once backfill drains the backlog.';
END $$;

-- ── 8. Qualification accuracy (20260830 fix): backfill/backlog-count and
--      fn_harvest_task_output's override path must agree with each other,
--      not just with condition_type/stage -- a task only "qualifies" if
--      harvesting it will ACTUALLY produce a harvested_files row. Found live
--      during manual testing: pre-fix, a project-less task with no override
--      counted as "qualifying" and backfill reported it as "processed" while
--      producing nothing. ─────────────────────────────────────────────────
DO $$
DECLARE
  c                RECORD;
  v_stage_dyn      UUID;  -- only v_rule_dynamic's tasks live here
  v_stage_ovr      UUID;  -- only v_rule_override's tasks live here -- kept
                          -- SEPARATE from v_stage_dyn: an override rule
                          -- qualifies EVERY matching-stage task with a
                          -- submission regardless of project_id (that's the
                          -- whole point of an override -- it doesn't gate
                          -- per-task on project at all), so sharing one
                          -- stage between both rules would make the
                          -- override rule's count include the dynamic
                          -- rule's fixture tasks too and the assertions
                          -- below ambiguous about which gate was proven.
  v_override_folder UUID;
  v_rule_dynamic   UUID;  -- no override -- needs project_id
  v_rule_override  UUID;  -- explicit destination -- must NOT need project_id
  v_task_positive  UUID;  -- has project + submission -- the control
  v_task_noproject UUID;  -- no project, dynamic rule -- must NOT qualify
  v_task_override  UUID;  -- no project, override rule -- MUST qualify
  v_task_nosub     UUID;  -- has project, no submission yet -- must NOT qualify
  v_task_override_withproject UUID;  -- override stage, but DOES have a project
  v_count          INT;
  v_touched        INT;
BEGIN
  SELECT * INTO c FROM hrpc_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_editor::text, true);

  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Qual Accuracy Dyn Stage ' || c.tag, 920) RETURNING id INTO v_stage_dyn;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position)
  VALUES (c.pipeline, 'HRPC Selfcheck Qual Accuracy Ovr Stage ' || c.tag, 921) RETURNING id INTO v_stage_ovr;
  INSERT INTO public.filehub_folders (company_id, name, created_by, scope)
  VALUES (c.company, 'HRPC Selfcheck Qual Accuracy Override Folder ' || c.tag, c.creator, 'broadcast')
  RETURNING id INTO v_override_folder;

  v_rule_dynamic  := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', v_stage_dyn, NULL, 60);
  v_rule_override := public.rpc_create_harvest_rule(c.pipeline, 'stage_entry', v_stage_ovr, v_override_folder, 60);

  -- 8a. Positive control: project set, submission seeded, dynamic (no
  -- override) rule -- must qualify and actually harvest.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Qual Positive ' || c.tag, c.creator, c.pipeline, c.project, v_stage_dyn)
  RETURNING id INTO v_task_positive;
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_positive, c.company, c.creator, c.tag, 'q-pos');

  -- 8b. project_id NULL, dynamic rule (no override) -- must NOT qualify.
  -- This is the exact scenario that silently no-op'd pre-fix.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Qual NoProject ' || c.tag, c.creator, c.pipeline, NULL, v_stage_dyn)
  RETURNING id INTO v_task_noproject;
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_noproject, c.company, c.creator, c.tag, 'q-noproj');

  -- 8d. project set, dynamic rule, but NO submission yet -- must NOT
  -- qualify (fn_harvest_task_output's v_submission IS NULL -> RETURN gate).
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Qual NoSubmission ' || c.tag, c.creator, c.pipeline, c.project, v_stage_dyn)
  RETURNING id INTO v_task_nosub;
  -- deliberately no hrpc_selfcheck_seed_submission call here.

  -- 8c. project_id NULL, on the SEPARATE stage the override rule watches --
  -- MUST qualify. Proves the override path no longer requires a project.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Qual Override ' || c.tag, c.creator, c.pipeline, NULL, v_stage_ovr)
  RETURNING id INTO v_task_override;
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_override, c.company, c.creator, c.tag, 'q-ovr');

  -- Backlog counts: dynamic rule sees exactly 1 (task_positive) --
  -- task_noproject and task_nosub correctly excluded.
  SELECT public.rpc_count_harvest_rule_backlog(v_rule_dynamic) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (8a/8b/8d): dynamic (no-override) rule backlog should be exactly 1 (only task_positive), got %. project-less and submission-less tasks must not be counted.', v_count;
  END IF;

  -- Override rule sees exactly 1 (task_override, the only task on its
  -- watched stage) -- proves the override rule qualifies a project-less
  -- task instead of proving it ignores project_id across the board (that
  -- second, stronger claim is proven separately below in the mixed-stage
  -- assertion).
  SELECT public.rpc_count_harvest_rule_backlog(v_rule_override) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (8c): override rule backlog should be exactly 1 (task_override, which has NO project), got %. The override path must not require project_id.', v_count;
  END IF;

  -- The stronger claim promised above: an override rule doesn't discriminate
  -- by project_id at all -- add a SECOND task on the same override-watched
  -- stage that DOES have a project, and confirm the backlog now counts BOTH
  -- (2), proving the override path treats project-having and project-less
  -- tasks identically rather than merely tolerating the project-less case.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, project_id, current_stage_id)
  VALUES (c.company, 'HRPC Selfcheck Qual Override WithProject ' || c.tag, c.creator, c.pipeline, c.project, v_stage_ovr)
  RETURNING id INTO v_task_override_withproject;
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_override_withproject, c.company, c.creator, c.tag, 'q-ovr-proj');

  SELECT public.rpc_count_harvest_rule_backlog(v_rule_override) INTO v_count;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (8c-strong): override rule backlog should now be 2 (task_override + task_override_withproject) -- the override path must count a project-HAVING task exactly the same as a project-less one, got %', v_count;
  END IF;

  -- Run both backfills and verify the ACTUAL harvested_files rows match --
  -- not just the returned count, the real end-to-end effect.
  v_touched := public.rpc_backfill_harvest_rule(v_rule_dynamic);
  IF v_touched <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (8 backfill-dynamic): expected exactly 1 task touched, got %', v_touched;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_dynamic AND source_task_id = v_task_positive) THEN
    RAISE EXCEPTION 'CHECK FAILED (8a): task_positive should have been actually harvested by the dynamic rule';
  END IF;
  IF EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_dynamic AND source_task_id = v_task_noproject) THEN
    RAISE EXCEPTION 'CHECK FAILED (8b): task_noproject must never appear in harvested_files under the dynamic rule -- it has no project and the rule has no override';
  END IF;
  IF EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_dynamic AND source_task_id = v_task_nosub) THEN
    RAISE EXCEPTION 'CHECK FAILED (8d): task_nosub must never appear in harvested_files -- it has no submission yet';
  END IF;

  v_touched := public.rpc_backfill_harvest_rule(v_rule_override);
  IF v_touched <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (8 backfill-override): expected exactly 2 tasks touched (task_override + task_override_withproject), got %', v_touched;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = v_rule_override AND source_task_id = v_task_override AND destination_folder_id = v_override_folder
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (8c): task_override (no project) should have been actually harvested into the rule''s explicit override folder -- this is the real end-to-end proof, not just the count';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.harvested_files
    WHERE harvest_rule_id = v_rule_override AND source_task_id = v_task_override_withproject AND destination_folder_id = v_override_folder
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (8c-strong): task_override_withproject (has a project) should ALSO land in the same override folder -- the override path must not silently prefer the dynamic per-project folder over its own explicit destination';
  END IF;

  -- 8e. The submission gate is dynamic, not a permanent exclusion: seed a
  -- submission for task_nosub now and confirm it becomes qualifying and
  -- backfillable.
  PERFORM public.hrpc_selfcheck_seed_submission(v_task_nosub, c.company, c.creator, c.tag, 'q-nosub-fixed');
  SELECT public.rpc_count_harvest_rule_backlog(v_rule_dynamic) INTO v_count;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (8e): after giving task_nosub a submission, dynamic rule backlog should be exactly 1 (task_nosub -- task_positive already harvested), got %', v_count;
  END IF;
  v_touched := public.rpc_backfill_harvest_rule(v_rule_dynamic);
  IF v_touched <> 1 OR NOT EXISTS (SELECT 1 FROM public.harvested_files WHERE harvest_rule_id = v_rule_dynamic AND source_task_id = v_task_nosub) THEN
    RAISE EXCEPTION 'CHECK FAILED (8e): task_nosub should now be harvestable once it has a submission, touched=%', v_touched;
  END IF;

  RAISE NOTICE 'OK (8): backfill/backlog-count now agree with fn_harvest_task_output''s real gates -- a project-less task with no override correctly never qualifies, the SAME project-less task correctly DOES qualify (and actually gets harvested) once the rule has an explicit override, a task with no submission yet is correctly excluded until it gets one, and every count is verified against the real harvested_files rows produced, not just the returned integers.';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL CHECKS PASSED: harvest_rules CRUD RPCs, the cascade-fix regression guard, backfill, stage_terminal_success, the rpc_delete_stage reference guard, rpc_count_harvest_rule_backlog, and the 20260830 qualification-accuracy fix (issue #284 Phases 3 + 5).';
END $$;

ROLLBACK;
