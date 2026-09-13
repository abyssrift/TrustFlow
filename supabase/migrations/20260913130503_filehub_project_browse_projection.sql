-- Issue #429 / FileHub follow-up Task 1.
-- Add the project workspace read model to the existing federated Browse path.
-- No storage objects or bytes are created by this migration.

-- The view is deliberately rebuilt so its append-only projection remains a
-- single source for the legacy and canonical FileHub identities.
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
SELECT 'submission'::text, a.id, a.company_id, 'submission-attachments'::text,
  a.storage_path, a.file_name, a.mime_type, a.file_size, a.category,
  a.uploaded_by, a.created_at, s.task_id, a.submission_id, NULL::uuid,
  NULL::uuid, NULL::text, t.project_id, t.category,
  NULL::uuid, NULL::text, 'submission'::text, a.filehub_file_id,
  a.filehub_file_version_id
FROM public.submission_attachments a
JOIN public.task_submissions s ON s.id = a.submission_id
LEFT JOIN public.tasks t ON t.id = s.task_id
WHERE s.deleted_at IS NULL AND a.version_id = s.current_version_id
UNION ALL
SELECT 'task_brief'::text, a.id, a.company_id, 'task-attachments'::text,
  a.storage_path, a.file_name, a.mime_type, a.file_size, a.category,
  a.uploaded_by, a.created_at, a.task_id, NULL::uuid, NULL::uuid,
  NULL::uuid, NULL::text, t.project_id, t.category,
  NULL::uuid, NULL::text, 'brief'::text, a.filehub_file_id,
  a.filehub_file_version_id
FROM public.task_attachments a
LEFT JOIN public.tasks t ON t.id = a.task_id
WHERE a.deleted_at IS NULL;

REVOKE ALL ON public.files_index FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.filehub_file_accessible(p_file_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.filehub_files f
    WHERE f.id = p_file_id AND f.deleted_at IS NULL
      AND f.company_id = public.my_company_id()
      AND (
        f.uploaded_by = auth.uid()
        OR f.visibility = 'broadcast'
        OR (f.visibility = 'direct' AND EXISTS (
          SELECT 1 FROM public.filehub_recipients r
          WHERE r.file_id = f.id AND r.user_id = auth.uid()))
        OR (f.visibility = 'group' AND f.group_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM public.filehub_group_members gm
                 WHERE gm.group_id = f.group_id AND gm.user_id = auth.uid())
          OR public.has_permission('filehub:group_override')
          OR public.has_permission('filehub:group_override_manage')))
        OR (f.visibility = 'task' AND f.task_id IS NOT NULL
            AND public.fn_task_file_accessible(f.task_id))
        OR (f.visibility = 'project' AND f.project_id IS NOT NULL
            AND public.fn_project_accessible(f.project_id))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.filehub_file_accessible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filehub_file_accessible(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean);
CREATE OR REPLACE FUNCTION public.rpc_filehub_browse(
  p_query text DEFAULT NULL, p_sources text[] DEFAULT NULL,
  p_project_id uuid DEFAULT NULL, p_category text DEFAULT NULL,
  p_type text DEFAULT NULL, p_before timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 60, p_file_id uuid DEFAULT NULL,
  p_include_facets boolean DEFAULT false, p_origins text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid := public.my_company_id();
  v_q text := trim(coalesce(p_query, ''));
  v_limit int := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_items jsonb; v_facets jsonb := NULL; v_pool int;
BEGIN
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('items','[]'::jsonb,'has_more',false,'facets',NULL);
  END IF;

  IF p_file_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_items
    FROM (
      SELECT fi.source, fi.file_id, fi.bucket, fi.storage_path, fi.file_name,
        fi.mime_type, fi.size_bytes, fi.category, fi.uploaded_by, fi.created_at,
        fi.task_id, fi.submission_id, fi.folder_id, fi.group_id, fi.visibility,
        fi.project_id, (SELECT p.name FROM public.projects p WHERE p.id=fi.project_id) AS project_name,
        fi.task_category, CASE WHEN fi.task_id IS NOT NULL THEN
          (SELECT t.title FROM public.tasks t WHERE t.id=fi.task_id) END AS task_title,
        fi.workspace_folder_id, fi.workspace_path, fi.origin,
        fi.canonical_file_id, fi.canonical_version_id
      FROM public.files_index fi
      WHERE fi.company_id=v_company AND fi.file_id=p_file_id
        AND (p_origins IS NULL OR fi.origin=ANY(p_origins))
        AND CASE WHEN fi.origin='workspace' THEN public.fn_project_accessible(fi.project_id)
          WHEN fi.source='filehub' THEN public.filehub_file_accessible(fi.file_id)
          ELSE public.fn_task_file_accessible(fi.task_id) END
    ) x;
    RETURN jsonb_build_object('items',v_items,'has_more',false,'facets',NULL);
  END IF;

  WITH pool AS (
    SELECT fi.* FROM public.files_index fi
    WHERE fi.company_id=v_company
      AND (p_sources IS NULL OR fi.source=ANY(p_sources))
      AND (p_origins IS NULL OR fi.origin=ANY(p_origins))
      AND (p_project_id IS NULL OR fi.project_id=p_project_id)
      AND (p_category IS NULL OR fi.category=p_category OR fi.task_category=p_category)
      AND (p_type IS NULL OR public.file_mime_class(fi.mime_type)=p_type)
      AND (p_before IS NULL OR fi.created_at < p_before)
      AND (v_q='' OR fi.file_name ILIKE '%'||v_q||'%' OR
        (fi.source='filehub' AND EXISTS (SELECT 1 FROM public.filehub_files ff
          WHERE ff.id=fi.file_id AND (ff.caption ILIKE '%'||v_q||'%' OR array_to_string(ff.tags,' ') ILIKE '%'||v_q||'%'))))
    ORDER BY fi.created_at DESC LIMIT v_limit*3
  ), acc AS (
    SELECT c.source,c.file_id,c.bucket,c.storage_path,c.file_name,c.mime_type,
      c.size_bytes,c.category,c.uploaded_by,c.created_at,c.task_id,c.submission_id,
      c.folder_id,c.group_id,c.visibility,c.project_id,
      (SELECT p.name FROM public.projects p WHERE p.id=c.project_id) AS project_name,
      c.task_category, CASE WHEN c.task_id IS NOT NULL THEN
        (SELECT t.title FROM public.tasks t WHERE t.id=c.task_id) END AS task_title,
      c.workspace_folder_id,c.workspace_path,c.origin,c.canonical_file_id,c.canonical_version_id
    FROM pool c
    WHERE CASE WHEN c.origin='workspace' THEN public.fn_project_accessible(c.project_id)
      WHEN c.source='filehub' THEN public.filehub_file_accessible(c.file_id)
      ELSE public.fn_task_file_accessible(c.task_id) END
    ORDER BY c.created_at DESC LIMIT v_limit
  )
  SELECT coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM acc a),'[]'::jsonb),
    (SELECT count(*) FROM pool) INTO v_items,v_pool;

  IF p_include_facets THEN
    WITH accessible AS (
      SELECT fi.* FROM public.files_index fi
      WHERE fi.company_id=v_company
        AND (p_sources IS NULL OR fi.source=ANY(p_sources))
        AND (p_origins IS NULL OR fi.origin=ANY(p_origins))
        AND CASE WHEN fi.origin='workspace' THEN public.fn_project_accessible(fi.project_id)
          WHEN fi.source='filehub' THEN public.filehub_file_accessible(fi.file_id)
          ELSE public.fn_task_file_accessible(fi.task_id) END
    )
    SELECT jsonb_build_object(
      'projects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',pid,'name',pname,'count',cnt) ORDER BY cnt DESC),'[]'::jsonb)
        FROM (SELECT a.project_id pid,(SELECT p.name FROM public.projects p WHERE p.id=a.project_id) pname,count(*) cnt
              FROM accessible a WHERE a.project_id IS NOT NULL GROUP BY a.project_id) pf),
      'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('category',cat,'count',cnt) ORDER BY cnt DESC),'[]'::jsonb)
        FROM (SELECT coalesce(a.task_category,a.category) cat,count(*) cnt FROM accessible a
              WHERE coalesce(a.task_category,a.category) IS NOT NULL GROUP BY coalesce(a.task_category,a.category)) cf),
      'types', (SELECT coalesce(jsonb_agg(jsonb_build_object('type',typ,'count',cnt) ORDER BY cnt DESC),'[]'::jsonb)
        FROM (SELECT public.file_mime_class(a.mime_type) typ,count(*) cnt FROM accessible a
              GROUP BY public.file_mime_class(a.mime_type)) tf)
    ) INTO v_facets;
  END IF;

  RETURN jsonb_build_object('items',v_items,'has_more',v_pool >= v_limit*3,'facets',v_facets);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[]) TO authenticated;
