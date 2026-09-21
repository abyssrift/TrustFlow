-- Issue #429 follow-up: project FileHub visibility must not survive ACL revoke
-- merely because the revoked member originally uploaded the file.
--
-- Shared FileHub scopes retain uploader ownership. Project scope is different:
-- fn_project_accessible (plus the existing roll-forward link) is the authority
-- for every reader, including the original uploader.

CREATE OR REPLACE FUNCTION public.filehub_file_accessible(p_file_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.filehub_files f
    WHERE f.id = p_file_id
      AND f.deleted_at IS NULL
      AND f.company_id = public.my_company_id()
      AND (
        (f.visibility <> 'project' AND f.uploaded_by = auth.uid())
        OR f.visibility = 'broadcast'
        OR (f.visibility = 'direct' AND public.fn_filehub_is_direct_recipient(f.id))
        OR (f.visibility = 'group' AND f.group_id IS NOT NULL AND public.fn_filehub_is_group_member(f.group_id))
        OR (f.visibility = 'task' AND f.task_id IS NOT NULL AND public.task_accessible(f.task_id))
        OR (f.visibility = 'project' AND f.project_id IS NOT NULL AND (
          public.fn_project_accessible(f.project_id)
          OR EXISTS (
            SELECT 1 FROM public.projects np
            WHERE np.rolled_forward_from_project_id = f.project_id
              AND public.fn_project_accessible(np.id)
          )
        ))
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.filehub_file_accessible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filehub_file_accessible(uuid) TO authenticated;

DROP POLICY IF EXISTS "filehub_files_select_visibility" ON public.filehub_files;
CREATE POLICY "filehub_files_select_visibility" ON public.filehub_files
  FOR SELECT USING (
    deleted_at IS NULL
    AND company_id = public.my_company_id()
    AND (
      (visibility <> 'project' AND uploaded_by = auth.uid())
      OR visibility = 'broadcast'
      OR (visibility = 'direct' AND public.fn_filehub_is_direct_recipient(id))
      OR (visibility = 'group' AND group_id IS NOT NULL AND public.fn_filehub_is_group_member(group_id))
      OR (visibility = 'task' AND task_id IS NOT NULL AND public.task_accessible(task_id))
      OR (visibility = 'project' AND project_id IS NOT NULL AND (
        public.fn_project_accessible(project_id)
        OR EXISTS (
          SELECT 1 FROM public.projects np
          WHERE np.rolled_forward_from_project_id = project_id
            AND public.fn_project_accessible(np.id)
        )
      ))
    )
  );
