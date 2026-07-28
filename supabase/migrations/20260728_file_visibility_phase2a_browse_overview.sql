-- FileHub file-visibility #163 Phase 2a (cont.): the two big FileHub read RPCs.
-- rpc_filehub_browse: all three per-row task ACL checks → fn_task_file_accessible.
-- rpc_filehub_overview: gate "recently assigned" by fn_task_file_accessible too,
-- so a file the pipeline policy hides never shows up in the list (recents already
-- go through filehub_file_accessible, updated in Phase 2a rows).

CREATE OR REPLACE FUNCTION public.rpc_filehub_browse(p_query text DEFAULT NULL::text, p_sources text[] DEFAULT NULL::text[], p_project_id uuid DEFAULT NULL::uuid, p_category text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 60, p_file_id uuid DEFAULT NULL::uuid, p_include_facets boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.my_company_id();
  v_q       text := trim(COALESCE(p_query, ''));
  v_limit   int  := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
  v_items   jsonb;
  v_facets  jsonb := NULL;
  v_pool    int;
BEGIN
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'has_more', false, 'facets', NULL);
  END IF;

  IF p_file_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT fi.source, fi.file_id, fi.bucket, fi.storage_path, fi.file_name,
             fi.mime_type, fi.size_bytes, fi.category, fi.uploaded_by, fi.created_at,
             fi.task_id, fi.submission_id, fi.folder_id, fi.group_id, fi.visibility,
             fi.project_id,
             (SELECT p.name FROM public.projects p WHERE p.id = fi.project_id) AS project_name,
             fi.task_category,
             CASE WHEN fi.task_id IS NOT NULL
                  THEN (SELECT t.title FROM public.tasks t WHERE t.id = fi.task_id) END AS task_title
      FROM public.files_index fi
      WHERE fi.company_id = v_company AND fi.file_id = p_file_id
        AND CASE WHEN fi.source = 'filehub' THEN public.filehub_file_accessible(fi.file_id)
                 ELSE public.fn_task_file_accessible(fi.task_id) END
    ) x;
    RETURN jsonb_build_object('items', v_items, 'has_more', false, 'facets', NULL);
  END IF;

  WITH pool AS (
    SELECT fi.*
    FROM public.files_index fi
    WHERE fi.company_id = v_company
      AND (p_sources IS NULL OR fi.source = ANY (p_sources))
      AND (p_project_id IS NULL OR fi.project_id = p_project_id)
      AND (p_category IS NULL OR fi.category = p_category OR fi.task_category = p_category)
      AND (p_type IS NULL OR public.file_mime_class(fi.mime_type) = p_type)
      AND (p_before IS NULL OR fi.created_at < p_before)
      AND (
        v_q = ''
        OR fi.file_name ILIKE '%' || v_q || '%'
        OR (fi.source = 'filehub' AND EXISTS (
          SELECT 1 FROM public.filehub_files ff
          WHERE ff.id = fi.file_id
            AND (ff.caption ILIKE '%' || v_q || '%'
                 OR array_to_string(ff.tags, ' ') ILIKE '%' || v_q || '%')
        ))
      )
    ORDER BY fi.created_at DESC
    LIMIT v_limit * 3
  ),
  acc AS (
    SELECT c.source, c.file_id, c.bucket, c.storage_path, c.file_name,
           c.mime_type, c.size_bytes, c.category, c.uploaded_by, c.created_at,
           c.task_id, c.submission_id, c.folder_id, c.group_id, c.visibility,
           c.project_id,
           (SELECT p.name FROM public.projects p WHERE p.id = c.project_id) AS project_name,
           c.task_category,
           CASE WHEN c.task_id IS NOT NULL
                THEN (SELECT t.title FROM public.tasks t WHERE t.id = c.task_id) END AS task_title
    FROM pool c
    WHERE CASE WHEN c.source = 'filehub' THEN public.filehub_file_accessible(c.file_id)
               ELSE public.fn_task_file_accessible(c.task_id) END
    ORDER BY c.created_at DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM acc a), '[]'::jsonb),
    (SELECT count(*) FROM pool)
  INTO v_items, v_pool;

  IF p_include_facets THEN
    WITH accessible AS (
      SELECT fi.*
      FROM public.files_index fi
      WHERE fi.company_id = v_company
        AND (p_sources IS NULL OR fi.source = ANY (p_sources))
        AND CASE WHEN fi.source = 'filehub' THEN public.filehub_file_accessible(fi.file_id)
                 ELSE public.fn_task_file_accessible(fi.task_id) END
    )
    SELECT jsonb_build_object(
      'projects', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pid, 'name', pname, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT a.project_id AS pid,
                 (SELECT p.name FROM public.projects p WHERE p.id = a.project_id) AS pname,
                 count(*) AS cnt
          FROM accessible a
          WHERE a.project_id IS NOT NULL
          GROUP BY a.project_id
        ) pf
      ),
      'categories', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('category', cat, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT COALESCE(a.task_category, a.category) AS cat, count(*) AS cnt
          FROM accessible a
          WHERE COALESCE(a.task_category, a.category) IS NOT NULL
          GROUP BY COALESCE(a.task_category, a.category)
        ) cf
      ),
      'types', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('type', typ, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT public.file_mime_class(a.mime_type) AS typ, count(*) AS cnt
          FROM accessible a
          GROUP BY public.file_mime_class(a.mime_type)
        ) tf
      )
    ) INTO v_facets;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'has_more', v_pool >= v_limit * 3,
    'facets', v_facets
  );
END;
$function$;

-- rpc_filehub_overview: add fn_task_file_accessible gate to recently_assigned.
CREATE OR REPLACE FUNCTION public.rpc_filehub_overview(p_recent_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.my_company_id();
  v_user    uuid := auth.uid();
  v_limit   int  := LEAST(GREATEST(COALESCE(p_recent_limit, 12), 1), 50);
  v_recent  jsonb;
  v_assigned jsonb;
  v_stats   jsonb;
BEGIN
  IF v_company IS NULL OR NOT public.has_permission('filehub:view') THEN
    RETURN jsonb_build_object('recent_files', '[]'::jsonb,
                              'recently_assigned', '[]'::jsonb,
                              'stats', '{}'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.last_opened_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT * FROM (
      SELECT DISTINCT ON (fa.file_id)
        fa.file_id,
        f.original_name,
        f.mime_type,
        f.size_bytes,
        f.bucket,
        f.storage_path,
        f.caption,
        f.visibility,
        f.group_id,
        f.folder_id,
        fa.created_at AS last_opened_at
      FROM public.filehub_activity fa
      JOIN public.filehub_files f
        ON f.id = fa.file_id AND f.deleted_at IS NULL AND f.company_id = v_company
      WHERE fa.user_id = v_user
        AND fa.action IN ('view', 'download')
      ORDER BY fa.file_id, fa.created_at DESC
    ) d
    WHERE public.filehub_file_accessible(d.file_id)
    ORDER BY d.last_opened_at DESC
    LIMIT v_limit
  ) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.assigned_at DESC), '[]'::jsonb)
  INTO v_assigned
  FROM (
    SELECT DISTINCT ON (fi.file_id)
      fi.source,
      fi.file_id,
      fi.file_name,
      fi.mime_type,
      fi.size_bytes,
      fi.bucket,
      fi.storage_path,
      fi.task_id,
      t.title AS task_title,
      fi.project_id,
      (SELECT p.name FROM public.projects p WHERE p.id = fi.project_id) AS project_name,
      fi.task_category,
      ta.assigned_at
    FROM public.files_index fi
    JOIN public.task_assignments ta ON ta.task_id = fi.task_id
    JOIN public.tasks t ON t.id = fi.task_id AND t.deleted_at IS NULL
    WHERE fi.company_id = v_company
      AND fi.source IN ('submission', 'task_brief')
      AND (
        ta.assignee_user_id = v_user
        OR ta.assignee_team_id IN (
          SELECT tm.team_id FROM public.team_members tm
          WHERE tm.user_id = v_user AND tm.removed_at IS NULL
        )
      )
      AND public.fn_task_file_accessible(fi.task_id)
    ORDER BY fi.file_id, ta.assigned_at DESC
    LIMIT v_limit * 4
  ) r;
  v_assigned := (
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'assigned_at') DESC), '[]'::jsonb)
    FROM (SELECT e FROM jsonb_array_elements(v_assigned) e
          ORDER BY (e->>'assigned_at') DESC LIMIT v_limit) s
  );

  SELECT jsonb_build_object(
    'files_7d', (SELECT count(*) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL AND visibility <> 'task'
                   AND created_at > now() - interval '7 days'),
    'bytes_7d', (SELECT COALESCE(sum(size_bytes), 0) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL AND visibility <> 'task'
                   AND created_at > now() - interval '7 days'),
    'inbox_unread', public.rpc_filehub_unread_count(),
    'my_channels', (SELECT count(*) FROM public.filehub_group_members
                    WHERE user_id = v_user)
  ) INTO v_stats;

  RETURN jsonb_build_object(
    'recent_files', v_recent,
    'recently_assigned', v_assigned,
    'stats', v_stats
  );
END;
$function$;
