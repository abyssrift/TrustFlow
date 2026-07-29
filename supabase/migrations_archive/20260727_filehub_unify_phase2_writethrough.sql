-- FileHub unification Phase 2 write-through (#151): new task files auto-get a
-- filehub_files pointer row. One BEFORE INSERT trigger on both source tables —
-- a single chokepoint instead of editing rpc_add_task_attachments /
-- rpc_replace_task_attachment / rpc_submit_work / rpc_edit_submission.
-- Fails safe: if it can't resolve an uploader or task, it skips the pointer
-- (leaves filehub_file_id NULL) rather than aborting the upload.

CREATE OR REPLACE FUNCTION public.filehub_link_task_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket   text;
  v_task_id  uuid;
  v_uploader uuid;
  v_existing uuid;
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

  -- Fail safe: no uploader or task → don't block the insert, just skip linking.
  IF v_uploader IS NULL OR v_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reuse an existing pointer for the same object (kept-attachment pointer-copy
  -- in rpc_edit_submission, or an idempotent re-run) instead of duplicating.
  SELECT id INTO v_existing
  FROM public.filehub_files
  WHERE company_id = NEW.company_id AND bucket = v_bucket
    AND storage_path = NEW.storage_path AND visibility = 'task'
  LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.filehub_files (
      company_id, uploaded_by, storage_path, bucket, original_name,
      mime_type, size_bytes, visibility, task_id, created_at
    ) VALUES (
      NEW.company_id, v_uploader, NEW.storage_path, v_bucket, NEW.file_name,
      NEW.mime_type, COALESCE(NEW.file_size, 0), 'task', v_task_id, COALESCE(NEW.created_at, now())
    ) RETURNING id INTO v_existing;
  END IF;

  NEW.filehub_file_id := v_existing;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filehub_link_task_file ON public.task_attachments;
CREATE TRIGGER trg_filehub_link_task_file
  BEFORE INSERT ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.filehub_link_task_file();

DROP TRIGGER IF EXISTS trg_filehub_link_task_file ON public.submission_attachments;
CREATE TRIGGER trg_filehub_link_task_file
  BEFORE INSERT ON public.submission_attachments
  FOR EACH ROW EXECUTE FUNCTION public.filehub_link_task_file();
