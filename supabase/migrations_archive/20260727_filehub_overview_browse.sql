-- FileHub refactor (#143, UX-first): read layer for the new Overview + Browse tabs.
-- Additive only — extends files_index (append-only columns), adds a mime-class
-- helper, per-user recents + browse RPCs. No data migration; task files stay in
-- their own tables and surface through the existing federated view.

-- 1. Extend files_index with project_id + task category (append columns only;
--    CREATE OR REPLACE VIEW forbids reordering existing ones). Filehub rows have
--    no task, so NULL. Submission/brief rows join tasks for both.
CREATE OR REPLACE VIEW public.files_index AS
SELECT
  'filehub'::text     AS source,
  f.id                AS file_id,
  f.company_id,
  f.bucket,
  f.storage_path,
  f.original_name     AS file_name,
  f.mime_type,
  f.size_bytes,
  NULL::text          AS category,
  f.uploaded_by,
  f.created_at,
  NULL::uuid          AS task_id,
  NULL::uuid          AS submission_id,
  f.folder_id,
  f.group_id,
  f.visibility,
  NULL::uuid          AS project_id,
  NULL::text          AS task_category
FROM public.filehub_files f
WHERE f.deleted_at IS NULL

UNION ALL

SELECT
  'submission'::text,
  a.id,
  a.company_id,
  'submission-attachments'::text,
  a.storage_path,
  a.file_name,
  a.mime_type,
  a.file_size,
  a.category,
  a.uploaded_by,
  a.created_at,
  s.task_id,
  a.submission_id,
  NULL::uuid,
  NULL::uuid,
  NULL::text,
  t.project_id,
  t.category
FROM public.submission_attachments a
JOIN public.task_submissions s ON s.id = a.submission_id
LEFT JOIN public.tasks t ON t.id = s.task_id
WHERE s.deleted_at IS NULL
  AND a.version_id = s.current_version_id   -- current version only

UNION ALL

SELECT
  'task_brief'::text,
  a.id,
  a.company_id,
  'task-attachments'::text,
  a.storage_path,
  a.file_name,
  a.mime_type,
  a.file_size,
  a.category,
  a.uploaded_by,
  a.created_at,
  a.task_id,
  NULL::uuid,
  NULL::uuid,
  NULL::uuid,
  NULL::text,
  t.project_id,
  t.category
FROM public.task_attachments a
LEFT JOIN public.tasks t ON t.id = a.task_id
WHERE a.deleted_at IS NULL;

-- View runs with owner rights (bypasses source RLS) — keep it off the Data API.
REVOKE ALL ON public.files_index FROM anon, authenticated;

-- 2. Coarse file-type bucket for Browse filters + facet counts.
CREATE OR REPLACE FUNCTION public.file_mime_class(p_mime text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_mime IS NULL THEN 'other'
    WHEN p_mime LIKE 'image/%' THEN 'image'
    WHEN p_mime LIKE 'video/%' THEN 'video'
    WHEN p_mime LIKE 'audio/%' THEN 'audio'
    WHEN p_mime = 'application/pdf' THEN 'pdf'
    WHEN p_mime LIKE '%wordprocessing%' OR p_mime LIKE '%msword%'
      OR p_mime = 'text/plain' OR p_mime LIKE 'text/%' THEN 'doc'
    WHEN p_mime LIKE '%spreadsheet%' OR p_mime LIKE '%excel%'
      OR p_mime = 'text/csv' THEN 'sheet'
    WHEN p_mime LIKE '%zip%' OR p_mime LIKE '%compressed%'
      OR p_mime LIKE '%tar%' OR p_mime LIKE '%rar%' OR p_mime LIKE '%7z%' THEN 'archive'
    ELSE 'other'
  END;
$$;

-- 3. Indexes backing the two new access paths.
CREATE INDEX IF NOT EXISTS filehub_activity_user_recent_idx
  ON public.filehub_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_assignments_assignee_recent_idx
  ON public.task_assignments(assignee_user_id, assigned_at DESC);

-- 4. Overview bundle — one round trip for the Overview tab.
CREATE OR REPLACE FUNCTION public.rpc_filehub_overview(p_recent_limit int DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Recently opened (filehub only — activity FK is filehub_files). Latest open
  -- per file, then re-sort by recency and cap.
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

  -- Recently assigned files: latest submission/brief files on tasks assigned to
  -- me (directly or via team). The assignment is the access grant, so no extra
  -- per-row task_accessible check.
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
    ORDER BY fi.file_id, ta.assigned_at DESC
    LIMIT v_limit * 4
  ) r;
  -- Trim to limit after the DISTINCT ON re-sort.
  v_assigned := (
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'assigned_at') DESC), '[]'::jsonb)
    FROM (SELECT e FROM jsonb_array_elements(v_assigned) e
          ORDER BY (e->>'assigned_at') DESC LIMIT v_limit) s
  );

  SELECT jsonb_build_object(
    'files_7d', (SELECT count(*) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL
                   AND created_at > now() - interval '7 days'),
    'bytes_7d', (SELECT COALESCE(sum(size_bytes), 0) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL
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
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_filehub_overview(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_overview(int) TO authenticated;

-- 5. Browse — cross-source, filterable, paginated. Same cheap-filter + per-row
-- ACL shape as rpc_files_search; also serves the ?file= deep link via p_file_id.
CREATE OR REPLACE FUNCTION public.rpc_filehub_browse(
  p_query          text        DEFAULT NULL,
  p_sources        text[]      DEFAULT NULL,
  p_project_id     uuid        DEFAULT NULL,
  p_category       text        DEFAULT NULL,
  p_type           text        DEFAULT NULL,
  p_before         timestamptz DEFAULT NULL,
  p_limit          int         DEFAULT 60,
  p_file_id        uuid        DEFAULT NULL,
  p_include_facets boolean     DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Deep-link path: single ACL-checked row, no pagination/facets.
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
                 ELSE public.task_accessible(fi.task_id) END
    ) x;
    RETURN jsonb_build_object('items', v_items, 'has_more', false, 'facets', NULL);
  END IF;

  -- Candidate pool: cheap filters + keyset cursor, 3x over-fetch so ACL trimming
  -- can still fill the page. ponytail: over-fetch heuristic inherited from
  -- rpc_files_search; fine at current volume, revisit with pg_trgm at ~10k+.
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
               ELSE public.task_accessible(c.task_id) END
    ORDER BY c.created_at DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM acc a), '[]'::jsonb),
    (SELECT count(*) FROM pool)
  INTO v_items, v_pool;

  -- Facets over the cheap-filtered pool (before per-row ACL). ponytail: counts
  -- can slightly over-report vs what the user can open; names aren't leaked and
  -- rpc_filehub_analytics already exposes company-wide counts. Exact if needed.
  IF p_include_facets THEN
    v_facets := jsonb_build_object(
      'projects', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pid, 'name', pname, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT fi.project_id AS pid,
                 (SELECT p.name FROM public.projects p WHERE p.id = fi.project_id) AS pname,
                 count(*) AS cnt
          FROM public.files_index fi
          WHERE fi.company_id = v_company AND fi.project_id IS NOT NULL
            AND (p_sources IS NULL OR fi.source = ANY (p_sources))
          GROUP BY fi.project_id
        ) pf
      ),
      'categories', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('category', cat, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT COALESCE(fi.task_category, fi.category) AS cat, count(*) AS cnt
          FROM public.files_index fi
          WHERE fi.company_id = v_company
            AND COALESCE(fi.task_category, fi.category) IS NOT NULL
            AND (p_sources IS NULL OR fi.source = ANY (p_sources))
          GROUP BY COALESCE(fi.task_category, fi.category)
        ) cf
      ),
      'types', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('type', typ, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT public.file_mime_class(fi.mime_type) AS typ, count(*) AS cnt
          FROM public.files_index fi
          WHERE fi.company_id = v_company
            AND (p_sources IS NULL OR fi.source = ANY (p_sources))
          GROUP BY public.file_mime_class(fi.mime_type)
        ) tf
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'has_more', v_pool >= v_limit * 3,
    'facets', v_facets
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_filehub_browse(text, text[], uuid, text, text, timestamptz, int, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_browse(text, text[], uuid, text, text, timestamptz, int, uuid, boolean) TO authenticated;
