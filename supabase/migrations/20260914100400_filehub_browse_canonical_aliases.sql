-- Issue #422/#429 follow-up: Browse aliases must resolve their canonical
-- FileHub pointer before falling back to legacy attachment columns.
--
-- Attachment rows remain the task/submission collection records. Their
-- filehub_file_id/filehub_file_version_id pointers are the storage identity;
-- this view must expose that identity's bucket and path so new uploads never
-- point the Browse preview at the retired attachment buckets.

CREATE OR REPLACE VIEW public.files_index AS
WITH RECURSIVE project_tree AS (
  SELECT p.id AS project_id, f.id AS folder_id, f.parent_id,
         f.id AS root_folder_id, f.project_root_kind AS root_kind,
         f.name::text AS workspace_path
  FROM public.projects p
  JOIN public.filehub_folders f
    ON f.id = p.workspace_folder_id OR f.id = p.deliverable_folder_id
  WHERE f.company_id = p.company_id AND f.scope = 'project'
    AND f.project_id = p.id AND f.parent_id IS NULL
    AND f.project_root_kind IN ('workspace', 'deliverable')
    AND f.deleted_at IS NULL
  UNION ALL
  SELECT pt.project_id, f.id, f.parent_id, pt.root_folder_id, pt.root_kind,
         (pt.workspace_path || ' / ' || f.name)::text
  FROM project_tree pt
  JOIN public.filehub_folders f ON f.parent_id = pt.folder_id
  WHERE f.company_id = (SELECT p.company_id FROM public.projects p WHERE p.id = pt.project_id)
    AND f.scope = 'project' AND f.project_id = pt.project_id
    AND f.project_root_kind IS NULL AND f.deleted_at IS NULL
)
SELECT 'filehub'::text AS source, f.id AS file_id, f.company_id, f.bucket,
  f.storage_path, f.original_name AS file_name, f.mime_type, f.size_bytes,
  NULL::text AS category, f.uploaded_by, f.created_at, NULL::uuid AS task_id,
  NULL::uuid AS submission_id, f.folder_id, f.group_id, f.visibility,
  NULL::uuid AS project_id, NULL::text AS task_category,
  NULL::uuid AS workspace_folder_id, NULL::text AS workspace_path,
  'shared'::text AS origin, f.id AS canonical_file_id,
  f.current_version_id AS canonical_version_id
FROM public.filehub_files f
WHERE f.deleted_at IS NULL AND f.visibility IN ('direct', 'broadcast', 'group')
UNION ALL
SELECT 'filehub'::text, f.id, f.company_id, f.bucket, f.storage_path,
  f.original_name, f.mime_type, f.size_bytes, NULL::text, f.uploaded_by,
  f.created_at, NULL::uuid, NULL::uuid, f.folder_id, f.group_id, f.visibility,
  f.project_id, NULL::text, pt.root_folder_id, pt.workspace_path,
  CASE WHEN pt.root_kind = 'deliverable' THEN 'deliverable' ELSE 'workspace' END::text,
  f.id, f.current_version_id
FROM public.filehub_files f
JOIN public.projects p ON p.id = f.project_id AND p.company_id = f.company_id
JOIN project_tree pt ON pt.project_id = f.project_id AND pt.folder_id = f.folder_id
WHERE f.deleted_at IS NULL AND f.visibility = 'project'
  AND p.deleted_at IS NULL
UNION ALL
SELECT 'submission'::text, a.id, a.company_id,
  COALESCE(cv.bucket, cf.bucket, 'submission-attachments'::text),
  COALESCE(cv.storage_path, cf.storage_path, a.storage_path),
  COALESCE(cv.original_name, cf.original_name, a.file_name),
  COALESCE(cv.mime_type, cf.mime_type, a.mime_type),
  COALESCE(cv.size_bytes, cf.size_bytes, a.file_size),
  a.category, a.uploaded_by, a.created_at, s.task_id, a.submission_id,
  NULL::uuid, NULL::uuid, NULL::text, t.project_id, t.category,
  NULL::uuid, NULL::text, 'submission'::text, a.filehub_file_id,
  COALESCE(a.filehub_file_version_id, cf.current_version_id)
FROM public.submission_attachments a
JOIN public.task_submissions s ON s.id = a.submission_id
LEFT JOIN public.tasks t ON t.id = s.task_id
LEFT JOIN public.filehub_files cf ON cf.id = a.filehub_file_id
LEFT JOIN public.filehub_file_versions cv
  ON cv.id = COALESCE(a.filehub_file_version_id, cf.current_version_id)
WHERE s.deleted_at IS NULL AND a.version_id = s.current_version_id
UNION ALL
SELECT 'task_brief'::text, a.id, a.company_id,
  COALESCE(cv.bucket, cf.bucket, 'task-attachments'::text),
  COALESCE(cv.storage_path, cf.storage_path, a.storage_path),
  COALESCE(cv.original_name, cf.original_name, a.file_name),
  COALESCE(cv.mime_type, cf.mime_type, a.mime_type),
  COALESCE(cv.size_bytes, cf.size_bytes, a.file_size),
  a.category, a.uploaded_by, a.created_at, a.task_id, NULL::uuid,
  NULL::uuid, NULL::uuid, NULL::text, t.project_id, t.category,
  NULL::uuid, NULL::text, 'brief'::text, a.filehub_file_id,
  COALESCE(a.filehub_file_version_id, cf.current_version_id)
FROM public.task_attachments a
LEFT JOIN public.tasks t ON t.id = a.task_id
LEFT JOIN public.filehub_files cf ON cf.id = a.filehub_file_id
LEFT JOIN public.filehub_file_versions cv
  ON cv.id = COALESCE(a.filehub_file_version_id, cf.current_version_id)
WHERE a.deleted_at IS NULL;
