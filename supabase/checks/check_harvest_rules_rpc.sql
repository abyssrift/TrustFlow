-- Runnable check for issue #284, Phase 3: harvest rule CRUD RPCs,
-- stage_terminal_success, backfill, and the cascade-fix regression guard.
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

DO $$ BEGIN
  RAISE NOTICE 'ALL CHECKS PASSED: harvest_rules CRUD RPCs, the cascade-fix regression guard, backfill, and stage_terminal_success (issue #284 Phase 3).';
END $$;

ROLLBACK;
