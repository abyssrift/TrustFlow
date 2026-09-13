-- Phase 2B (#422) database contract check.
-- Run against the local stack with psql; the transaction is rolled back.

BEGIN;

DO $$
DECLARE
  v_missing BIGINT;
  v_bad BIGINT;
  v_def TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_attachments'
      AND column_name = 'filehub_file_version_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submission_attachments'
      AND column_name = 'filehub_file_version_id'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: immutable FileHub version pointers are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_attachment_versions'
      AND column_name = 'filehub_file_version_id'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: task_attachment_versions lacks its FileHub version pointer';
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.task_attachments a
  WHERE a.storage_path IS NOT NULL
    AND a.filehub_file_id IS NOT NULL
    AND a.filehub_file_version_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: % task attachment pointers are not converged', v_missing;
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.submission_attachments a
  WHERE a.storage_path IS NOT NULL
    AND a.filehub_file_id IS NOT NULL
    AND a.filehub_file_version_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: % submission attachment pointers are not converged', v_missing;
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.task_attachment_versions v
  JOIN public.task_attachments a ON a.id = v.attachment_id
  WHERE a.filehub_file_id IS NOT NULL AND v.filehub_file_version_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: % legacy brief versions are not linked to FileHub versions', v_missing;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.task_attachments a
  JOIN public.filehub_file_versions v ON v.id = a.filehub_file_version_id
  WHERE a.filehub_file_id IS DISTINCT FROM v.file_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: task attachment version pointers cross file boundaries (% rows)', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.submission_attachments a
  JOIN public.filehub_file_versions v ON v.id = a.filehub_file_version_id
  WHERE a.filehub_file_id IS DISTINCT FROM v.file_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: submission attachment version pointers cross file boundaries (% rows)', v_bad;
  END IF;

  IF position('filehub_file_version_id' IN pg_get_functiondef('public.rpc_edit_submission(uuid,text,uuid[],jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_edit_submission does not copy immutable FileHub version pointers';
  END IF;
  IF position('filehub_file_version_id' IN pg_get_functiondef('public.rpc_submit_work(uuid,text,uuid,uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_submit_work does not preserve explicit FileHub version pointers';
  END IF;

  IF position('filehub_file_version_id' IN pg_get_functiondef('public.rpc_replace_task_attachment(uuid,text,text,bigint,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_replace_task_attachment does not maintain immutable FileHub version pointers';
  END IF;
  IF position('filehub_file_version_id' IN pg_get_functiondef('public.rpc_add_task_attachments(uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: rpc_add_task_attachments does not write the legacy-to-FileHub version pointer';
  END IF;
  v_def := pg_get_functiondef('public.filehub_link_task_file()'::regprocedure);
  IF position('v_storage_path' IN v_def) = 0
     OR position('NEW.file_url' IN v_def) = 0
     OR position('FileHub version pointer does not belong' IN v_def) = 0
  THEN
    RAISE EXCEPTION 'CHECK FAILED: FileHub pointer trigger does not derive legacy metadata from the immutable version';
  END IF;
  IF position('rpc_task_filehub_attachment_pointers' IN pg_get_functiondef('public.rpc_task_filehub_attachment_pointers(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: task-detail FileHub pointer read RPC is missing';
  END IF;
  IF to_regprocedure('public.rpc_task_attachment_filehub_replace(uuid,uuid,text,text,bigint,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: legacy task attachment FileHub replacement fallback is missing';
  END IF;

  FOREACH v_def IN ARRAY ARRAY[
    'public.rpc_task_filehub_upload_commit(uuid,text,text,text,bigint,text,text,uuid)',
    'public.rpc_task_filehub_replace_file(uuid,uuid,text,bigint,text,text,text,uuid)',
    'public.rpc_task_attachment_filehub_replace(uuid,uuid,text,text,bigint,text,text,text,uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_def, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_def, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'CHECK FAILED: task FileHub SECURITY DEFINER RPC must be authenticated-only: %', v_def;
    END IF;
  END LOOP;

  RAISE NOTICE 'ALL CHECKS PASSED: task/submission attachments converge on immutable FileHub versions while legacy metadata remains available.';
END $$;

ROLLBACK;
