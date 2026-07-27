-- FileHub unification (#151/#152 follow-up): the Phase 2 write-through trigger
-- creates a filehub_files pointer when a task file is uploaded, but nothing
-- retires it. So soft-deleting a brief file, deleting a submission, or
-- superseding a submission version left the pointer live — a "deleted" file
-- stayed openable via FileHub recents and kept inflating counts. This adds the
-- symmetric retire path: soft-delete the pointer (mirrors FileHub's own Bin)
-- when its source goes away, and un-delete on restore.
--
-- ponytail: covers the soft-delete lifecycle (task_attachments.deleted_at,
-- task_submissions.deleted_at / current_version_id), which is how these files
-- are actually removed. No hard-delete path exists today; if one is ever added,
-- add an AFTER DELETE handler here too.

-- ── Brief files: task_attachments.deleted_at drives the pointer ───────────────
CREATE OR REPLACE FUNCTION public.filehub_sync_task_attachment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.filehub_file_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.filehub_files
       SET deleted_at = NEW.deleted_at
     WHERE id = NEW.filehub_file_id AND deleted_at IS NULL;
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE public.filehub_files
       SET deleted_at = NULL
     WHERE id = NEW.filehub_file_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filehub_sync_attachment_delete ON public.task_attachments;
CREATE TRIGGER trg_filehub_sync_attachment_delete
  AFTER UPDATE OF deleted_at ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.filehub_sync_task_attachment_delete();

-- Trigger functions must not be REST-callable (default PUBLIC grant); revoking
-- EXECUTE doesn't affect trigger firing (triggers run as the table owner).
REVOKE EXECUTE ON FUNCTION public.filehub_sync_task_attachment_delete() FROM PUBLIC, anon, authenticated;

-- ── Submission files: submission_attachments has no deleted_at, so the
--    lifecycle lives on task_submissions (whole-submission delete + version
--    supersession). Keep exactly the current version's files as live pointers. ─
CREATE OR REPLACE FUNCTION public.filehub_sync_submission_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whole submission soft-deleted / restored → retire / revive all its pointers.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.filehub_files ff SET deleted_at = NEW.deleted_at
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id AND ff.deleted_at IS NULL;
    RETURN NEW;
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE public.filehub_files ff SET deleted_at = NULL
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id
      AND a.version_id IS NOT DISTINCT FROM NEW.current_version_id;  -- only current version comes back live
    RETURN NEW;
  END IF;

  -- New current version → retire superseded versions' pointers, keep current live.
  IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id AND NEW.deleted_at IS NULL THEN
    UPDATE public.filehub_files ff SET deleted_at = now()
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id
      AND a.version_id IS DISTINCT FROM NEW.current_version_id AND ff.deleted_at IS NULL;

    UPDATE public.filehub_files ff SET deleted_at = NULL
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id
      AND a.version_id IS NOT DISTINCT FROM NEW.current_version_id AND ff.deleted_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filehub_sync_submission_delete ON public.task_submissions;
CREATE TRIGGER trg_filehub_sync_submission_delete
  AFTER UPDATE OF deleted_at, current_version_id ON public.task_submissions
  FOR EACH ROW EXECUTE FUNCTION public.filehub_sync_submission_delete();

REVOKE EXECUTE ON FUNCTION public.filehub_sync_submission_delete() FROM PUBLIC, anon, authenticated;

-- ── One-time reconciliation: retire pointers whose source is already gone ─────
-- brief files already soft-deleted before this trigger existed
UPDATE public.filehub_files ff SET deleted_at = a.deleted_at
FROM public.task_attachments a
WHERE a.filehub_file_id = ff.id AND a.deleted_at IS NOT NULL AND ff.deleted_at IS NULL;

-- submissions already soft-deleted
UPDATE public.filehub_files ff SET deleted_at = COALESCE(s.deleted_at, now())
FROM public.submission_attachments a
JOIN public.task_submissions s ON s.id = a.submission_id
WHERE a.filehub_file_id = ff.id AND s.deleted_at IS NOT NULL AND ff.deleted_at IS NULL;

-- superseded (non-current) submission-version pointers
UPDATE public.filehub_files ff SET deleted_at = now()
FROM public.submission_attachments a
JOIN public.task_submissions s ON s.id = a.submission_id
WHERE a.filehub_file_id = ff.id
  AND s.deleted_at IS NULL
  AND a.version_id IS DISTINCT FROM s.current_version_id
  AND ff.deleted_at IS NULL;
