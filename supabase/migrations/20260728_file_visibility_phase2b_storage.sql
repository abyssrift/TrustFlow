-- FileHub file-visibility #163 Phase 2b (storage): the byte boundary. The three
-- task-file bucket SELECT policies were company-wide; tighten them to the same
-- fn_task_file_accessible policy the rows now use, so signing a task-file URL
-- requires task access (or being its uploader), not just company membership.
--
-- Paths are {company}/tasks/{task_id}/… (task id at foldername[3]) for all three
-- buckets. The CASE regex-guards the ::uuid cast so a non-conforming path can
-- NEVER throw (a thrown predicate would break ALL reads for the bucket) — such
-- paths fall back to company-scope, exactly as before. `owner = auth.uid()` keeps
-- the uploader able to read their own object regardless of the pipeline policy.

ALTER POLICY task_attachments_storage_select ON storage.objects
  USING (
    bucket_id = 'task-attachments'
    AND (storage.foldername(name))[1] = public.my_company_id()::text
    AND (
      (storage.foldername(name))[2] IS DISTINCT FROM 'tasks'
      OR owner = auth.uid()
      OR CASE WHEN (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN public.fn_task_file_accessible(((storage.foldername(name))[3])::uuid)
              ELSE true END
    )
  );

ALTER POLICY submission_attachments_storage_select ON storage.objects
  USING (
    bucket_id = 'submission-attachments'
    AND (storage.foldername(name))[1] = public.my_company_id()::text
    AND (
      (storage.foldername(name))[2] IS DISTINCT FROM 'tasks'
      OR owner = auth.uid()
      OR CASE WHEN (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN public.fn_task_file_accessible(((storage.foldername(name))[3])::uuid)
              ELSE true END
    )
  );

ALTER POLICY task_submissions_storage_select ON storage.objects
  USING (
    bucket_id = 'task-submissions'
    AND (storage.foldername(name))[1] = public.my_company_id()::text
    AND (
      (storage.foldername(name))[2] IS DISTINCT FROM 'tasks'
      OR owner = auth.uid()
      OR CASE WHEN (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN public.fn_task_file_accessible(((storage.foldername(name))[3])::uuid)
              ELSE true END
    )
  );
