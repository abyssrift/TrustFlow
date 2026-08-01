-- check_rpc_spreadsheet_intake.sql
--
-- NOT a migration — nothing under supabase/checks/ is auto-applied. Run this
-- by hand against a local/staging Postgres you can write to (NEVER prod):
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -f - < supabase/checks/check_rpc_spreadsheet_intake.sql
--
-- Issue #188 / plan §15 — covers what 20260801_spreadsheet_intake_portfolio_folder.sql
-- ADDED on top of the already-checked batch-config RPC (see
-- check_rpc_batch_config.sql, which this does not repeat):
--
--   1. portfolios.standing_folder_id is written from
--      p_portfolio->>'standing_folder_id' — the FileHub evidence trail
--      (plan §15.3 "the file is evidence") actually lands.
--   2. rpc_filehub_folder_create is a true get-or-create at the SAME
--      (parent, name, scope) — calling it twice for "Portfolio Imports"
--      returns the same folder id, never a duplicate (the exact bug
--      20260716_filehub_folder_create_idempotent.sql fixed; re-verified here
--      because BulkCreateProjectsSheet.getOrCreateStandingFolder depends on
--      it holding).
--   3. Idempotency (§15.3 "re-importing the same file is a no-op"): calling
--      rpc_instantiate_template twice with the SAME content-hash-derived key
--      creates exactly ONE portfolio and does not touch clients — simulates
--      the same file dropped twice.
--   4. Client identity (§13.3, already checked at the RPC level by
--      20260731_project_hierarchy_5_gap_fixes.sql, re-verified here in the
--      spreadsheet-intake shape): a row matched by external_ref does not
--      create a second client, and the row-count delta on `clients` is
--      exactly the number of genuinely NEW clients — the acceptance test
--      plan §15.4 #2 asks for ("known clients matched, not duplicated —
--      verified by clients row count before/after").
--
-- Cleans up its own scratch pipeline/stage/template/portfolios/projects/
-- tasks/clients/folders on success so it's safe to re-run.

DO $$
DECLARE
  v_user_id        UUID;
  v_company_id     UUID;
  v_tag            TEXT := replace(gen_random_uuid()::text, '-', '');
  v_pipe_a         UUID;
  v_stage_a        UUID;
  v_template_id    UUID;
  v_body           JSONB;
  v_mapping        JSONB;
  v_root_folder    UUID;
  v_root_folder_2  UUID;
  v_leaf_folder    UUID;
  v_portfolio_id   UUID;
  v_result         JSONB;
  v_result2        JSONB;
  v_standing_id    UUID;
  v_key            TEXT := 'spreadsheet:selfcheck-' || v_tag;
  v_existing_client_id UUID;
  v_clients_before  INT;
  v_clients_after   INT;
  v_projects_payload JSONB;
BEGIN
  SELECT p.company_id INTO v_company_id
  FROM public.pipelines p
  WHERE p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.pipeline_id = p.id)
  GROUP BY p.company_id
  HAVING COUNT(*) >= 1
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company with a stage-having pipeline found — seed one before running this check.';
  END IF;

  SELECT id INTO v_user_id FROM public.users WHERE is_owner = true AND company_id = v_company_id LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No owner user found for company %.', v_company_id;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT p.id, s.id INTO v_pipe_a, v_stage_a
  FROM public.pipelines p JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.company_id = v_company_id AND p.deleted_at IS NULL LIMIT 1;

  v_body := jsonb_build_array(jsonb_build_object('title', 'Task 1', 'category', 'General'));
  INSERT INTO public.project_templates (company_id, name, body, created_by)
  VALUES (v_company_id, 'selfcheck-intake-template-' || v_tag, v_body, v_user_id)
  RETURNING id INTO v_template_id;

  v_mapping := jsonb_build_array(jsonb_build_object('category', 'General', 'pipeline_id', v_pipe_a));

  -- ── 1 & 2: get-or-create folder is idempotent ────────────────────────────
  SELECT public.rpc_filehub_folder_create('selfcheck-Portfolio Imports-' || v_tag, NULL, 'broadcast') INTO v_root_folder;
  SELECT public.rpc_filehub_folder_create('selfcheck-Portfolio Imports-' || v_tag, NULL, 'broadcast') INTO v_root_folder_2;
  IF v_root_folder IS DISTINCT FROM v_root_folder_2 THEN
    RAISE EXCEPTION 'rpc_filehub_folder_create is not idempotent: % vs %', v_root_folder, v_root_folder_2;
  END IF;
  RAISE NOTICE 'check 1/2 PASSED: rpc_filehub_folder_create get-or-create is idempotent (folder %)', v_root_folder;

  SELECT public.rpc_filehub_folder_create('selfcheck-batch-' || v_tag, v_root_folder, 'broadcast') INTO v_leaf_folder;

  -- ── existing client to match by external_ref, so the "matched not
  --    duplicated" delta below is exercised against a REAL existing row ────
  INSERT INTO public.clients (company_id, name, external_ref)
  VALUES (v_company_id, 'Selfcheck Existing Client ' || v_tag, 'SELFCHECK-REF-' || v_tag)
  RETURNING id INTO v_existing_client_id;

  SELECT COUNT(*) INTO v_clients_before FROM public.clients WHERE company_id = v_company_id;

  -- Two rows: one matches the existing client BY REF (with a deliberately
  -- DIFFERENT name, proving ref wins over name per §13.3), one is genuinely new.
  v_projects_payload := jsonb_build_array(
    jsonb_build_object('name', 'Selfcheck Renamed On The Sheet ' || v_tag, 'client_ref', 'Selfcheck Existing Client ' || v_tag, 'client_external_ref', 'SELFCHECK-REF-' || v_tag),
    jsonb_build_object('name', 'Selfcheck Brand New ' || v_tag, 'client_ref', 'Selfcheck Brand New Client ' || v_tag)
  );

  -- ── 3: standing_folder_id lands on the portfolio row ─────────────────────
  SELECT public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-intake-batch-' || v_tag, 'target_date', (now() + interval '1 day')::text, 'anchor_direction', 'start', 'standing_folder_id', v_leaf_folder),
    v_projects_payload,
    v_mapping,
    v_key
  ) INTO v_result;

  v_portfolio_id := (v_result->>'portfolio_id')::uuid;
  SELECT standing_folder_id INTO v_standing_id FROM public.portfolios WHERE id = v_portfolio_id;
  IF v_standing_id IS DISTINCT FROM v_leaf_folder THEN
    RAISE EXCEPTION 'standing_folder_id did not land: expected %, got %', v_leaf_folder, v_standing_id;
  END IF;
  RAISE NOTICE 'check 3 PASSED: portfolios.standing_folder_id written correctly (folder %)', v_standing_id;

  -- ── 4: ref match did not duplicate; delta is exactly 1 new client ────────
  SELECT COUNT(*) INTO v_clients_after FROM public.clients WHERE company_id = v_company_id;
  IF v_clients_after - v_clients_before <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 new client (the ref-matched row must NOT duplicate), got delta %', v_clients_after - v_clients_before;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE portfolio_id = v_portfolio_id AND client_id = v_existing_client_id) THEN
    RAISE EXCEPTION 'the ref-matched row was not linked to the pre-existing client %', v_existing_client_id;
  END IF;
  RAISE NOTICE 'check 4 PASSED: known client matched by ref (not duplicated) — clients delta = %', v_clients_after - v_clients_before;

  -- ── 5: same content-hash-derived idempotency key twice -> ONE portfolio,
  --    ZERO new clients on the replay (simulates the same file dropped twice) ─
  SELECT COUNT(*) INTO v_clients_before FROM public.clients WHERE company_id = v_company_id;
  SELECT public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-intake-batch-' || v_tag, 'target_date', (now() + interval '1 day')::text, 'anchor_direction', 'start', 'standing_folder_id', v_leaf_folder),
    v_projects_payload,
    v_mapping,
    v_key -- SAME key as above
  ) INTO v_result2;
  SELECT COUNT(*) INTO v_clients_after FROM public.clients WHERE company_id = v_company_id;

  IF NOT (v_result2->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'replaying the same idempotency_key must report already_processed=true, got %', v_result2;
  END IF;
  IF (v_result2->>'portfolio_id')::uuid <> v_portfolio_id THEN
    RAISE EXCEPTION 'replay returned a DIFFERENT portfolio_id — this is the exact "same file dropped twice creates two portfolios" bug plan §15.3 forbids';
  END IF;
  IF (SELECT COUNT(*) FROM public.portfolios WHERE idempotency_key = v_key) <> 1 THEN
    RAISE EXCEPTION 'more than one portfolio carries idempotency_key %', v_key;
  END IF;
  IF v_clients_after <> v_clients_before THEN
    RAISE EXCEPTION 'replay must not touch clients at all, but count changed by %', v_clients_after - v_clients_before;
  END IF;
  RAISE NOTICE 'check 5 PASSED: same idempotency_key replayed -> ONE portfolio, zero new clients (the "same file dropped twice" acceptance test)';

  -- ── cleanup ───────────────────────────────────────────────────────────
  DELETE FROM public.task_assignments WHERE task_id IN (SELECT id FROM public.tasks WHERE portfolio_id = v_portfolio_id);
  DELETE FROM public.tasks WHERE portfolio_id = v_portfolio_id;
  DELETE FROM public.projects WHERE portfolio_id = v_portfolio_id;
  DELETE FROM public.portfolios WHERE id = v_portfolio_id;
  DELETE FROM public.clients WHERE company_id = v_company_id AND name LIKE 'Selfcheck%' || v_tag;
  DELETE FROM public.project_templates WHERE id = v_template_id;
  DELETE FROM public.filehub_folders WHERE id IN (v_leaf_folder, v_root_folder);

  RAISE NOTICE 'check_rpc_spreadsheet_intake.sql: ALL CHECKS PASSED';
END $$;
