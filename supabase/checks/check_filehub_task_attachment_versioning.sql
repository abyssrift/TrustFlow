-- Runnable check for the 20260907080841_filehub_task_attachment_versioning.sql fix:
-- filehub_link_task_file() must version every NEW task/submission attachment
-- it links, not just leave current_version_id NULL forever. Found live
-- while manually testing issue #284's harvest trigger end-to-end -- a real
-- submission through the real UI produced a filehub_files row with no
-- version, which silently made it unharvestable (fn_harvest_task_output
-- requires current_version_id IS NOT NULL).
--
-- Exercises the REAL insert paths (a plain INSERT into task_attachments /
-- submission_attachments, exactly what rpc_submit_work and the task-detail
-- attachment upload do), not a call to any helper that already knows how to
-- version things -- the whole point is proving the TRIGGER itself does it.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_filehub_task_attachment_versioning.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates one throwaway company/task, always
-- rolls back, safe to re-run. Both task-notification triggers are disabled
-- transactionally below: inserting the fixture task otherwise reaches
-- notification_events and its pg_net dispatcher can POST to production.

BEGIN;

-- ALTER TABLE is transactional in Postgres, so ROLLBACK restores both
-- triggers even when an assertion raises. Keep the attachment triggers live;
-- only suppress the unrelated notification fan-out and its production
-- dispatcher while this check creates its throwaway task.
ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;
ALTER TABLE public.tasks DISABLE TRIGGER trg_tasks_notify_insert;

DO $$
DECLARE
  v_company     UUID;
  v_user        UUID := gen_random_uuid();
  v_task        UUID;
  v_submission  UUID;
  v_tag         TEXT := replace(gen_random_uuid()::text, '-', '');
  v_ta_file     UUID;  -- filehub_files.id linked from task_attachments
  v_sa_file     UUID;  -- filehub_files.id linked from submission_attachments
  v_version_no  INT;
  v_stale_count INT;
  v_dispatch_enabled "char";
  v_task_notify_enabled "char";
BEGIN
  INSERT INTO public.companies (name, slug)
  VALUES ('FHV Selfcheck Co ' || v_tag, 'fhv-selfcheck-' || v_tag)
  RETURNING id INTO v_company;

  INSERT INTO auth.users (id, email) VALUES (v_user, 'fhv-selfcheck-' || v_tag || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner)
  VALUES (v_user, v_company, 'fhv-selfcheck-' || v_tag || '@test.local', true);

  INSERT INTO public.tasks (company_id, title, created_by)
  VALUES (v_company, 'FHV Selfcheck Task ' || v_tag, v_user)
  RETURNING id INTO v_task;

  -- ── 1. task_attachments: a plain INSERT (what the real upload path does) ──
  INSERT INTO public.task_attachments (task_id, company_id, uploaded_by, file_name, file_url, file_size, mime_type, storage_path)
  VALUES (v_task, v_company, v_user, 'brief.pdf', 'https://example.invalid/brief', 1234, 'application/pdf', 'selfcheck/fhv/' || v_tag || '/brief.pdf')
  RETURNING filehub_file_id INTO v_ta_file;

  IF v_ta_file IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): task_attachments insert did not get linked to a filehub_files row at all';
  END IF;

  IF (SELECT current_version_id FROM public.filehub_files WHERE id = v_ta_file) IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): filehub_link_task_file linked a task_attachments row but left current_version_id NULL -- the exact pre-fix bug';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.filehub_file_versions v
    JOIN public.filehub_files ff ON ff.current_version_id = v.id
    WHERE ff.id = v_ta_file AND v.version_no = 1 AND v.storage_path = 'selfcheck/fhv/' || v_tag || '/brief.pdf'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): version row missing or does not match the attachment''s own storage_path/version_no=1';
  END IF;

  -- ── 2. submission_attachments: same proof, the OTHER branch of the trigger ─
  INSERT INTO public.task_submissions (task_id, company_id, submitted_by, status, submitted_at)
  VALUES (v_task, v_company, v_user, 'pending', now())
  RETURNING id INTO v_submission;

  INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path)
  VALUES (v_submission, v_company, v_user, 'output.zip', 'https://example.invalid/output', 'selfcheck/fhv/' || v_tag || '/output.zip')
  RETURNING filehub_file_id INTO v_sa_file;

  IF v_sa_file IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (2a): submission_attachments insert did not get linked to a filehub_files row at all';
  END IF;

  SELECT v.version_no INTO v_version_no
  FROM public.filehub_file_versions v
  JOIN public.filehub_files ff ON ff.current_version_id = v.id
  WHERE ff.id = v_sa_file;

  IF v_version_no IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2b): submission_attachments-linked file should have exactly version_no=1 as its current version, got %', v_version_no;
  END IF;

  -- ── 3. Re-inserting an attachment with the SAME storage_path (the
  -- rpc_edit_submission "kept attachment" pointer-copy shape) reuses the
  -- existing filehub_files row rather than duplicating -- and must NOT
  -- create a second version_no=1 row for it. ──────────────────────────────
  DECLARE
    v_sa_file_2 UUID;
  BEGIN
    INSERT INTO public.submission_attachments (submission_id, company_id, uploaded_by, file_name, file_url, storage_path)
    VALUES (v_submission, v_company, v_user, 'output.zip', 'https://example.invalid/output', 'selfcheck/fhv/' || v_tag || '/output.zip')
    RETURNING filehub_file_id INTO v_sa_file_2;

    IF v_sa_file_2 <> v_sa_file THEN
      RAISE EXCEPTION 'CHECK FAILED (3a): a second attachment at the same storage_path should reuse the same filehub_files row, got a different one';
    END IF;

    IF (SELECT count(*) FROM public.filehub_file_versions WHERE file_id = v_sa_file) <> 1 THEN
      RAISE EXCEPTION 'CHECK FAILED (3b): reusing an existing file must not create a second version row';
    END IF;
  END;

  -- ── 4. Company-wide invariant this migration's own self-check already
  -- asserted once at apply time -- re-assert it here as a standing guard: no
  -- non-deleted filehub_files row should ever have a NULL current_version_id.
  SELECT count(*) INTO v_stale_count
  FROM public.filehub_files
  WHERE current_version_id IS NULL AND deleted_at IS NULL;
  IF v_stale_count > 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (4): % non-deleted filehub_files rows have no current_version_id -- the backfill regressed or something is inserting around the trigger', v_stale_count;
  END IF;

  -- Prove the notification safeguards were active for the whole fixture run;
  -- if either named trigger is absent or enabled, this check is inconclusive
  -- rather than claiming rollback safety while risking a pg_net POST.
  SELECT tgenabled INTO v_dispatch_enabled
  FROM pg_trigger
  WHERE tgrelid = 'public.notification_events'::regclass
    AND tgname = 'trg_dispatch_notification_event';
  IF v_dispatch_enabled IS NULL THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (5): trg_dispatch_notification_event not found -- cannot prove nothing was POSTed';
  END IF;
  IF v_dispatch_enabled <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED (5): trg_dispatch_notification_event was enabled (tgenabled=%) while this check created notification-producing fixtures', v_dispatch_enabled;
  END IF;

  SELECT tgenabled INTO v_task_notify_enabled
  FROM pg_trigger
  WHERE tgrelid = 'public.tasks'::regclass
    AND tgname = 'trg_tasks_notify_insert';
  IF v_task_notify_enabled IS NULL THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (6): trg_tasks_notify_insert not found -- cannot prove task notification fan-out was suppressed';
  END IF;
  IF v_task_notify_enabled <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED (6): trg_tasks_notify_insert was enabled (tgenabled=%) while this check created a throwaway task', v_task_notify_enabled;
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED: filehub_link_task_file versions every task_attachments/submission_attachments insert (version_no=1, current_version_id set), reuse does not duplicate versions, and no non-deleted filehub_files row is missing a version company-wide.';
END $$;

ROLLBACK;
