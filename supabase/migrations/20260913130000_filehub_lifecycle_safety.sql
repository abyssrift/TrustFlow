-- Phase 2C/4 (#423): fail-closed FileHub lifecycle safety.
--
-- This is deliberately a read-only predicate. Purge workers call it before
-- removing an object and again before deleting its row. Any task/submission
-- pointer or project deliverable reference keeps the FileHub object alive.
-- The predicate is SECURITY DEFINER so service-role workers are not coupled
-- to the caller's RLS visibility.

CREATE OR REPLACE FUNCTION public.filehub_purge_is_safe(
  p_file_id uuid,
  p_version_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target AS (
    SELECT f.id AS file_id,
           v.id AS version_id,
           COALESCE(CASE WHEN p_version_id IS NULL THEN f.bucket ELSE v.bucket END, 'filehub-files') AS bucket,
           CASE WHEN p_version_id IS NULL THEN f.storage_path ELSE v.storage_path END AS storage_path,
           f.visibility,
           f.project_id,
           f.folder_id
    FROM public.filehub_files f
    LEFT JOIN public.filehub_file_versions v ON v.id = p_version_id
    WHERE f.id = p_file_id
      AND (p_version_id IS NULL OR v.file_id = f.id)
  ),
  protected AS (
    SELECT 1
    FROM target t
    WHERE
      -- Task and project visibility are owned by their source/project
      -- pointers, not by a generic Bin retention worker.
      t.visibility IN ('task', 'project')
      OR t.project_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.deliverable_folder_id = t.folder_id
      )
      OR EXISTS (
        SELECT 1 FROM public.task_attachments a
        WHERE a.filehub_file_id = t.file_id
           OR a.filehub_file_version_id IN (
                SELECT fv.id FROM public.filehub_file_versions fv WHERE fv.file_id = t.file_id
              )
      )
      OR EXISTS (
        SELECT 1 FROM public.submission_attachments a
        WHERE a.filehub_file_id = t.file_id
           OR a.filehub_file_version_id IN (
                SELECT fv.id FROM public.filehub_file_versions fv WHERE fv.file_id = t.file_id
              )
      )
      OR EXISTS (
        SELECT 1
        FROM public.submission_attachments a
        JOIN public.task_submission_versions sv ON sv.id = a.version_id
        WHERE a.filehub_file_id = t.file_id
           OR a.filehub_file_version_id IN (
                SELECT fv.id FROM public.filehub_file_versions fv WHERE fv.file_id = t.file_id
              )
           OR a.storage_path = t.storage_path
      )
      OR EXISTS (
        SELECT 1 FROM public.task_attachment_versions av
        WHERE av.filehub_file_version_id IN (
                SELECT fv.id FROM public.filehub_file_versions fv WHERE fv.file_id = t.file_id
              )
      )
      OR EXISTS (
        SELECT 1 FROM public.filehub_files other
        WHERE other.id <> t.file_id
          AND COALESCE(other.bucket, 'filehub-files') = t.bucket
          AND other.storage_path = t.storage_path
      )
      OR EXISTS (
        SELECT 1 FROM public.filehub_file_versions other
        WHERE other.storage_path = t.storage_path
          AND COALESCE(other.bucket, 'filehub-files') = t.bucket
          AND (other.file_id <> t.file_id OR (p_version_id IS NOT NULL AND other.id <> t.version_id))
      )
      -- Legacy attachment tables do not carry bucket columns. A matching
      -- path is conservatively treated as shared physical ownership during
      -- migration, regardless of which historical bucket produced it.
      OR EXISTS (
        SELECT 1 FROM public.task_attachments a
        WHERE a.storage_path = t.storage_path
      )
      OR EXISTS (
        SELECT 1 FROM public.task_attachment_versions av
        WHERE av.storage_path = t.storage_path
      )
      OR EXISTS (
        SELECT 1 FROM public.submission_attachments a
        WHERE a.storage_path = t.storage_path
      )
  )
  SELECT EXISTS (SELECT 1 FROM target)
     AND NOT EXISTS (SELECT 1 FROM protected);
$$;

REVOKE ALL ON FUNCTION public.filehub_purge_is_safe(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filehub_purge_is_safe(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.filehub_purge_is_safe(uuid, uuid) IS
  'Issue #423: fail-closed guard for FileHub storage/row purge. Task and submission pointers, task version history, and project deliverables retain the referenced file/version.';
