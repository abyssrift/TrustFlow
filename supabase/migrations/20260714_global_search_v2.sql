-- Global search v2: tighten task visibility to match the board, add date-field
-- targeting (due/completed/created), and gate reports behind report.view.
-- (Archived items are searched separately via the existing rpc_get_archives.)

-- task_list_visible: mirrors the tasks_select_visibility RLS policy exactly, so
-- search surfaces precisely the tasks a user already sees in their lists/board —
-- honouring pipeline scope (task_visibility_mode) and the view_all permissions.
-- (task_accessible keys off task.view_detail, a different axis; not used for the
-- search list gate anymore.)
CREATE OR REPLACE FUNCTION public.task_list_visible(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.deleted_at IS NULL
      AND t.company_id = public.my_company_id()
      AND (
        public.has_permission('system.view_all_data')
        OR COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
        OR EXISTS (
          SELECT 1 FROM public.pipelines p
          WHERE p.id = t.pipeline_id
            AND (
              public.has_permission('task.view_all')
              OR public.has_permission('tasks.view_all')
              OR p.task_visibility_mode = 'all'
              OR (p.task_visibility_mode = 'assigned_only' AND (
                   t.created_by = auth.uid()
                   OR t.manager_id = auth.uid()
                   OR EXISTS (
                     SELECT 1 FROM public.task_assignments ta
                     WHERE ta.task_id = t.id
                       AND (
                         ta.assignee_user_id = auth.uid()
                         OR ta.assignee_team_id IN (
                           SELECT tm.team_id FROM public.team_members tm
                           WHERE tm.user_id = auth.uid() AND tm.removed_at IS NULL
                         )
                       )
                   )
                 ))
            )
        )
        OR (t.pipeline_id IS NULL AND (
              t.created_by = auth.uid()
              OR t.manager_id = auth.uid()
              OR public.has_permission('task.view_all')
              OR public.has_permission('tasks.view_all')
           ))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.task_list_visible(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.task_list_visible(uuid) TO authenticated;

-- Old 5-arg signature is replaced by a 6-arg one (adds p_date_field). Drop first
-- so PostgREST doesn't see an ambiguous overload.
DROP FUNCTION IF EXISTS public.rpc_global_search(text, text[], timestamptz, timestamptz, int);

CREATE OR REPLACE FUNCTION public.rpc_global_search(
  p_terms      text,
  p_types      text[]      DEFAULT NULL,   -- subset of ['task','report','comment','file']
  p_from       timestamptz DEFAULT NULL,
  p_to         timestamptz DEFAULT NULL,
  p_limit      int         DEFAULT 40,
  p_date_field text        DEFAULT NULL    -- 'due' | 'completed' | 'created' (tasks only)
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company uuid    := public.my_company_id();
  v_terms   text    := trim(COALESCE(p_terms, ''));
  v_has     boolean := v_terms <> '';
  v_tsq     tsquery := CASE WHEN v_terms <> '' THEN websearch_to_tsquery('english', v_terms) END;
  v_like    text    := '%' || v_terms || '%';
  v_limit   int     := LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
  v_field   text    := CASE WHEN p_date_field IN ('due','completed','created') THEN p_date_field ELSE 'created' END;
  v_result  jsonb;
BEGIN
  IF v_company IS NULL OR (NOT v_has AND p_from IS NULL AND p_to IS NULL) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH candidates AS (
    -- tasks (eff_date = the targeted column)
    SELECT 'task'::text AS type, t.id, t.title AS title,
           CASE WHEN v_has THEN ts_headline('english', coalesce(t.description, t.title), v_tsq,
                                            'MaxFragments=1,MaxWords=14,MinWords=4')
                ELSE left(coalesce(t.description,''), 120) END AS snippet,
           CASE WHEN v_has THEN ts_rank(t.search_tsv, v_tsq) ELSE 0 END AS score,
           t.created_at, t.id AS task_id, 'task'::text AS acl,
           CASE v_field WHEN 'due' THEN t.due_date WHEN 'completed' THEN t.completed_at ELSE t.created_at END AS eff_date
    FROM public.tasks t
    WHERE t.company_id = v_company AND t.deleted_at IS NULL
      AND (NOT v_has OR t.search_tsv @@ v_tsq)

    UNION ALL
    -- reports
    SELECT 'report', r.id, initcap(replace(r.report_type,'_',' ')),
           CASE WHEN v_has THEN ts_headline('english', coalesce(r.parameters::text,''), v_tsq,
                                            'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE r.status END,
           CASE WHEN v_has THEN ts_rank(r.search_tsv, v_tsq) ELSE 0 END,
           r.created_at, NULL::uuid, 'report', r.created_at
    FROM public.reporting_jobs r
    WHERE r.company_id = v_company
      AND (NOT v_has OR r.search_tsv @@ v_tsq)

    UNION ALL
    -- comments (gated by parent task visibility)
    SELECT 'comment', c.id, left(c.content, 60),
           CASE WHEN v_has THEN ts_headline('english', coalesce(c.content,''), v_tsq,
                                            'MaxFragments=1,MaxWords=16,MinWords=4')
                ELSE left(c.content, 120) END,
           CASE WHEN v_has THEN ts_rank(c.search_tsv, v_tsq) ELSE 0 END,
           c.created_at, c.task_id, 'task', c.created_at
    FROM public.task_comments c
    WHERE c.company_id = v_company AND c.deleted_at IS NULL
      AND (NOT v_has OR c.search_tsv @@ v_tsq)

    UNION ALL
    -- filehub files (tsvector)
    SELECT 'file', f.id, f.original_name,
           CASE WHEN v_has THEN ts_headline('english', coalesce(f.caption, f.original_name), v_tsq,
                                            'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE coalesce(f.caption,'') END,
           CASE WHEN v_has THEN ts_rank(f.search_tsv, v_tsq) ELSE 0 END,
           f.created_at, NULL::uuid, 'filehub', f.created_at
    FROM public.filehub_files f
    WHERE f.company_id = v_company AND f.deleted_at IS NULL
      AND (NOT v_has OR f.search_tsv @@ v_tsq)

    UNION ALL
    -- submission / task_brief attachments (name-matched via files_index)
    SELECT 'file', fi.file_id, fi.file_name, fi.file_name,
           0::real, fi.created_at, fi.task_id, 'task', fi.created_at
    FROM public.files_index fi
    WHERE fi.company_id = v_company
      AND fi.source IN ('submission','task_brief')
      AND (NOT v_has OR fi.file_name ILIKE v_like)
  ),
  filtered AS (
    SELECT * FROM candidates c
    WHERE (p_types IS NULL OR c.type = ANY (p_types))
      AND (p_from IS NULL OR c.eff_date >= p_from)
      AND (p_to   IS NULL OR c.eff_date <= p_to)
    ORDER BY c.score DESC, c.created_at DESC
    -- ponytail: over-fetch 3x so access filtering can still fill p_limit.
    LIMIT v_limit * 3
  ),
  allowed AS (
    SELECT * FROM filtered f
    WHERE CASE f.acl
      WHEN 'task'    THEN f.task_id IS NOT NULL AND public.task_list_visible(f.task_id)
      WHEN 'filehub' THEN public.filehub_file_accessible(f.id)
      WHEN 'report'  THEN public.has_permission('report.view')
                          OR COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
      ELSE FALSE
    END
    ORDER BY f.score DESC, f.created_at DESC
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type',       a.type,
    'id',         a.id,
    'title',      a.title,
    'snippet',    a.snippet,
    'score',      a.score,
    'created_at', a.created_at,
    'task_id',    a.task_id
  ) ORDER BY a.score DESC, a.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM allowed a;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_global_search(text, text[], timestamptz, timestamptz, int, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_global_search(text, text[], timestamptz, timestamptz, int, text) TO authenticated;
