-- FileHub Browse pagination correction.
-- Add a deterministic file_id tie-breaker without breaking existing named callers.

DROP FUNCTION IF EXISTS public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean);
DROP FUNCTION IF EXISTS public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[]);
DROP FUNCTION IF EXISTS public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[],uuid);
CREATE OR REPLACE FUNCTION public.rpc_filehub_browse(
  p_query text DEFAULT NULL, p_sources text[] DEFAULT NULL,
  p_project_id uuid DEFAULT NULL, p_category text DEFAULT NULL,
  p_type text DEFAULT NULL, p_before timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 60, p_file_id uuid DEFAULT NULL,
  p_include_facets boolean DEFAULT false, p_origins text[] DEFAULT NULL,
  p_before_file_id uuid DEFAULT NULL)
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
        AND CASE WHEN fi.origin IN ('workspace','deliverable') THEN public.fn_project_accessible(fi.project_id)
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
      AND (p_before IS NULL OR fi.created_at < p_before
        OR (p_before_file_id IS NOT NULL AND fi.created_at = p_before
          AND fi.file_id < p_before_file_id))
      AND (v_q='' OR fi.file_name ILIKE '%'||v_q||'%' OR
        (fi.source='filehub' AND EXISTS (SELECT 1 FROM public.filehub_files ff
          WHERE ff.id=fi.file_id AND (ff.caption ILIKE '%'||v_q||'%' OR array_to_string(ff.tags,' ') ILIKE '%'||v_q||'%'))))
    ORDER BY fi.created_at DESC, fi.file_id DESC LIMIT v_limit*3
  ), acc AS (
    SELECT c.source,c.file_id,c.bucket,c.storage_path,c.file_name,c.mime_type,
      c.size_bytes,c.category,c.uploaded_by,c.created_at,c.task_id,c.submission_id,
      c.folder_id,c.group_id,c.visibility,c.project_id,
      (SELECT p.name FROM public.projects p WHERE p.id=c.project_id) AS project_name,
      c.task_category, CASE WHEN c.task_id IS NOT NULL THEN
        (SELECT t.title FROM public.tasks t WHERE t.id=c.task_id) END AS task_title,
      c.workspace_folder_id,c.workspace_path,c.origin,c.canonical_file_id,c.canonical_version_id
    FROM pool c
    WHERE CASE WHEN c.origin IN ('workspace','deliverable') THEN public.fn_project_accessible(c.project_id)
      WHEN c.source='filehub' THEN public.filehub_file_accessible(c.file_id)
      ELSE public.fn_task_file_accessible(c.task_id) END
    ORDER BY c.created_at DESC, c.file_id DESC LIMIT v_limit
  )
  SELECT coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC, a.file_id DESC) FROM acc a),'[]'::jsonb),
    (SELECT count(*) FROM pool) INTO v_items,v_pool;

  IF p_include_facets THEN
    WITH accessible AS (
      SELECT fi.* FROM public.files_index fi
      WHERE fi.company_id=v_company
        AND (p_sources IS NULL OR fi.source=ANY(p_sources))
        AND (p_origins IS NULL OR fi.origin=ANY(p_origins))
        AND CASE WHEN fi.origin IN ('workspace','deliverable') THEN public.fn_project_accessible(fi.project_id)
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
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[],uuid) TO authenticated;
