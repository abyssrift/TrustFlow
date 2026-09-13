-- Phase 2C/4 (#423): lifecycle safety contract.
-- Run against the local stack with psql; the transaction is rolled back.

BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.filehub_purge_is_safe(uuid,uuid)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: filehub_purge_is_safe(uuid,uuid) is missing';
  END IF;

  v_def := pg_get_functiondef('public.filehub_purge_is_safe(uuid,uuid)'::regprocedure);
  IF position('task_attachment_versions' IN v_def) = 0
     OR position('submission_attachments' IN v_def) = 0
     OR position('task_submission_versions' IN v_def) = 0
     OR position('deliverable_folder_id' IN v_def) = 0
  THEN
    RAISE EXCEPTION 'CHECK FAILED: purge predicate does not cover every lifecycle reference';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.filehub_purge_is_safe(uuid,uuid)'::regprocedure
      AND proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: purge predicate must pin search_path';
  END IF;

  IF to_regclass('public.filehub_purge_claims') IS NULL
     OR to_regprocedure('public.rpc_filehub_purge_claim(text,text)') IS NULL
     OR to_regprocedure('public.rpc_filehub_purge_claim_target(text,text,uuid,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.rpc_filehub_purge_release(text,text)') IS NULL
     OR to_regprocedure('public.rpc_filehub_purge_folder_leaf(uuid,timestamptz,uuid)') IS NULL
     OR to_regprocedure('public.rpc_filehub_purge_folder_leaf_batch(timestamptz,uuid,integer)') IS NULL
  THEN
    RAISE EXCEPTION 'CHECK FAILED: serialized purge claim contract is missing';
  END IF;

  v_def := pg_get_functiondef('public.rpc_filehub_purge_claim_target(text,text,uuid,uuid,uuid,uuid)'::regprocedure);
  IF position('pg_advisory_xact_lock' IN v_def) = 0
     OR position('task_attachments' IN v_def) = 0
  THEN
    RAISE EXCEPTION 'CHECK FAILED: purge claims do not serialize against legacy pointer writers';
  END IF;

  IF has_function_privilege('authenticated', 'public.rpc_filehub_purge_claim(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rpc_filehub_purge_claim_target(text,text,uuid,uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rpc_filehub_purge_release(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rpc_filehub_purge_folder_leaf(uuid,timestamptz,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rpc_filehub_purge_folder_leaf_batch(timestamptz,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.rpc_filehub_purge_claim(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.rpc_filehub_purge_claim_target(text,text,uuid,uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.rpc_filehub_purge_folder_leaf(uuid,timestamptz,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.rpc_filehub_purge_folder_leaf_batch(timestamptz,uuid,integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'CHECK FAILED: purge claims must be service-role-only';
  END IF;

  v_def := pg_get_functiondef('public.rpc_filehub_purge_folder_leaf(uuid,timestamptz,uuid)'::regprocedure);
  IF position('FOR UPDATE' IN v_def) = 0
     OR position('NOT EXISTS' IN v_def) = 0
     OR position('project_id IS NULL' IN v_def) = 0
  THEN
    RAISE EXCEPTION 'CHECK FAILED: folder purge must lock and atomically verify a non-project leaf';
  END IF;

  v_def := pg_get_functiondef('public.rpc_filehub_purge_folder_leaf_batch(timestamptz,uuid,integer)'::regprocedure);
  IF position('NOT EXISTS' IN v_def) = 0
     OR position('rpc_filehub_purge_folder_leaf' IN v_def) = 0
  THEN
    RAISE EXCEPTION 'CHECK FAILED: folder purge batch must select leaves and call the locked delete';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.rpc_replace_task_attachment(uuid,text,text,bigint,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_replace_task_attachment(uuid,text,text,bigint,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_edit_submission(uuid,text,uuid[],jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_edit_submission(uuid,text,uuid[],jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'CHECK FAILED: converged task/submission mutators have unsafe execute grants';
  END IF;

  FOREACH v_def IN ARRAY ARRAY[
    'trg_filehub_files_purge_claim_guard',
    'trg_filehub_versions_purge_claim_guard',
    'trg_task_attachments_purge_claim_guard',
    'trg_task_attachment_versions_purge_claim_guard',
    'trg_submission_attachments_purge_claim_guard'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname=v_def AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION 'CHECK FAILED: purge claim writer trigger is missing: %', v_def;
    END IF;
  END LOOP;

  RAISE NOTICE 'ALL CHECKS PASSED: FileHub purge is reference-aware and deliverable-safe.';
END $$;

ROLLBACK;
