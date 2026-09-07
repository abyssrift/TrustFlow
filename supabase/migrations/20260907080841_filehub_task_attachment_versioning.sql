-- Pre-existing, separate from issue #284, but discovered while manually
-- testing #284's harvest trigger end-to-end: filehub_link_task_file() (the
-- BEFORE INSERT trigger on task_attachments/submission_attachments) has
-- NEVER created a filehub_file_versions row, since it was written before
-- Model B versioning existed (20260709_submission_versioning.sql,
-- 20260709_task_attachment_versioning.sql shipped versioning for the
-- SUBMISSION layer -- task_submission_versions -- but this trigger, which
-- runs underneath that on every attachment insert regardless of caller, was
-- never updated to also version the FILEHUB layer). Confirmed live: 40 of 42
-- real task-linked filehub_files rows in this dataset have current_version_id
-- IS NULL, including one created THIS SESSION by the real submission UI --
-- this is a current, active gap, not stale pre-migration data.
--
-- Why one version forever, not real multi-version tracking: checked
-- rpc_edit_submission's actual body first, rather than assuming. Submissions
-- have their OWN versioning system (task_submission_versions) --
-- deliberately kept separate from FileHub's; a full unification was
-- previously attempted and found too costly. Editing a submission NEVER
-- mutates an existing submission_attachments row's storage_path in place --
-- "kept" attachments get a brand-new row (same storage_path) under the new
-- submission version, "old version keeps its own rows untouched" (the
-- function's own comment). A task-linked filehub_files row's storage_path
-- therefore never changes after creation -- version_no=1, created once,
-- permanently current, is the CORRECT complete model for this file class,
-- not a simplification. Real multi-version replace (rpc_filehub_replace_file)
-- already exists separately and isn't reachable from task/submission
-- attachments through the UI (different visibility scope, not browsable
-- there).
--
-- Fix, in two parts:
--   1. filehub_link_task_file() creates the version_no=1 row (mirroring
--      rpc_filehub_upload_commit's exact insert shape) and sets
--      current_version_id, in the branch that creates a NEW filehub_files
--      row. Fixed in the trigger, not each calling RPC (rpc_submit_work,
--      rpc_edit_submission, ...) -- it's the one choke point every
--      task/submission attachment insert already passes through regardless
--      of caller, so no future upload path can reintroduce this exact bug
--      by forgetting to also version. The reuse branch (v_existing IS NOT
--      NULL) needs no change: by the time this trigger runs, section 2's
--      backfill below has already given every existing row a version, so
--      there is nothing left to lazily self-heal there.
--   2. One-time backfill for the 40 already-broken rows -- without it,
--      every EXISTING real submission stays permanently unharvestable even
--      after part 1 ships, since nothing else will ever touch them again.

-- ============================================================
-- Section 1: filehub_link_task_file() -- version every newly-created row
-- ============================================================
CREATE OR REPLACE FUNCTION public.filehub_link_task_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bucket     text;
  v_task_id    uuid;
  v_uploader   uuid;
  v_existing   uuid;
  v_final_name text;
  v_version_id uuid;
BEGIN
  IF NEW.storage_path IS NULL OR NEW.filehub_file_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'task_attachments' THEN
    v_bucket   := 'task-attachments';
    v_task_id  := NEW.task_id;
    v_uploader := COALESCE(NEW.uploaded_by, (SELECT created_by FROM public.tasks WHERE id = NEW.task_id));
  ELSE  -- submission_attachments
    v_bucket := 'submission-attachments';
    SELECT s.task_id, COALESCE(NEW.uploaded_by, s.submitted_by)
      INTO v_task_id, v_uploader
    FROM public.task_submissions s
    WHERE s.id = NEW.submission_id;
  END IF;

  -- Fail safe: no uploader or task -> don't block the insert, just skip linking.
  IF v_uploader IS NULL OR v_task_id IS NULL THEN
    RAISE WARNING 'filehub_link_task_file: could not resolve uploader/task for % row % (task_id=%, uploader=%)',
      TG_TABLE_NAME, NEW.id, v_task_id, v_uploader;
    RETURN NEW;
  END IF;

  -- Serialize reuse-check-then-insert within this task's scope (mirrors
  -- rpc_filehub_upload_commit's lock around filehub_dedupe_name). Without
  -- it, two attachment inserts landing close together for the same task
  -- both see "not found" and both insert -- the exact bug behind #35's 30
  -- duplicate rows.
  -- Keep the shared helper as the canonical lock path used by the hardening
  -- migration, with the same company/task scope as the original implementation.
  PERFORM public.filehub_advisory_lock(NEW.company_id::text || '|task|' || v_task_id::text);

  -- Reuse an existing pointer for the same object (kept-attachment pointer-copy
  -- in rpc_edit_submission, or an idempotent re-run) instead of duplicating.
  SELECT id INTO v_existing
  FROM public.filehub_files
  WHERE company_id = NEW.company_id AND bucket = v_bucket
    AND storage_path = NEW.storage_path AND visibility = 'task'
  LIMIT 1;

  IF v_existing IS NULL THEN
    v_final_name := public.filehub_dedupe_name(NEW.file_name, 'task', NULL, NULL, v_task_id);

    INSERT INTO public.filehub_files (
      company_id, uploaded_by, storage_path, bucket, original_name,
      mime_type, size_bytes, visibility, task_id, created_at
    ) VALUES (
      NEW.company_id, v_uploader, NEW.storage_path, v_bucket, v_final_name,
      NEW.mime_type, COALESCE(NEW.file_size, 0), 'task', v_task_id, COALESCE(NEW.created_at, now())
    ) RETURNING id INTO v_existing;

    -- A task-linked file's storage_path never mutates in place (see this
    -- migration's header) -- exactly one version, forever, created here.
    INSERT INTO public.filehub_file_versions (
      file_id, company_id, version_no, storage_path, bucket,
      original_name, size_bytes, mime_type, created_by
    ) VALUES (
      v_existing, NEW.company_id, 1, NEW.storage_path, v_bucket,
      v_final_name, COALESCE(NEW.file_size, 0), NEW.mime_type, v_uploader
    ) RETURNING id INTO v_version_id;

    UPDATE public.filehub_files SET current_version_id = v_version_id WHERE id = v_existing;
  END IF;

  NEW.filehub_file_id := v_existing;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- Section 2: one-time backfill for already-broken rows
-- ============================================================
INSERT INTO public.filehub_file_versions (
  file_id, company_id, version_no, storage_path, bucket,
  original_name, size_bytes, mime_type, created_by, created_at
)
SELECT
  ff.id, ff.company_id, 1, ff.storage_path, ff.bucket,
  ff.original_name, ff.size_bytes, ff.mime_type, ff.uploaded_by, ff.created_at
FROM public.filehub_files ff
WHERE ff.current_version_id IS NULL
  AND ff.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.filehub_file_versions v WHERE v.file_id = ff.id);

UPDATE public.filehub_files ff
SET current_version_id = v.id
FROM public.filehub_file_versions v
WHERE v.file_id = ff.id
  AND ff.current_version_id IS NULL
  AND ff.deleted_at IS NULL
  AND v.superseded_at IS NULL;

-- ============================================================
-- Migration self-check
-- ============================================================
DO $$
DECLARE
  v_still_broken INT;
BEGIN
  SELECT count(*) INTO v_still_broken
  FROM public.filehub_files
  WHERE current_version_id IS NULL AND deleted_at IS NULL;

  IF v_still_broken > 0 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: % non-deleted filehub_files rows still have no current_version_id after the backfill', v_still_broken;
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED: 20260907080841_filehub_task_attachment_versioning.sql -- filehub_link_task_file now versions every new task/submission attachment, and every pre-existing non-deleted file has been backfilled a version.';
END $$;
