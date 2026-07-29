-- Global search v3: as-you-type prefix matching, people entity, and pg_trgm
-- typo tolerance. Gating unchanged where it existed; people are company-scoped
-- exactly like the users_select_same_company RLS policy (all company members see
-- each other, deleted_at IS NULL).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes on the "name" fields where typos matter most (word_similarity).
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm         ON public.tasks         USING GIN (title         gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_filehub_name_trgm        ON public.filehub_files USING GIN (original_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm     ON public.users         USING GIN (full_name     gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.rpc_global_search(
  p_terms      text,
  p_types      text[]      DEFAULT NULL,   -- ['task','report','comment','file','person']
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
  v_tsq     tsquery;
  v_like    text    := '%' || v_terms || '%';
  v_limit   int     := LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
  v_field   text    := CASE WHEN p_date_field IN ('due','completed','created') THEN p_date_field ELSE 'created' END;
  v_result  jsonb;
BEGIN
  IF v_company IS NULL OR (NOT v_has AND p_from IS NULL AND p_to IS NULL) THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Build a prefix tsquery so the word being typed matches as-you-type
  -- ("onboard" hits "onboarding"). Append :* to every lexeme.
  IF v_has THEN
    v_tsq := websearch_to_tsquery('english', v_terms);
    IF v_tsq IS NOT NULL AND v_tsq::text <> '' THEN
      v_tsq := to_tsquery('english', regexp_replace(v_tsq::text, '''([^'']+)''', '''\1'':*', 'g'));
    END IF;
  END IF;

  WITH candidates AS (
    -- tasks (tsv/prefix + trigram typo tolerance on title)
    SELECT 'task'::text AS type, t.id, t.title AS title,
           CASE WHEN v_has THEN ts_headline('english', coalesce(t.description, t.title), COALESCE(v_tsq, plainto_tsquery('english', v_terms)),
                                            'MaxFragments=1,MaxWords=14,MinWords=4')
                ELSE left(coalesce(t.description,''), 120) END AS snippet,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND t.search_tsv @@ v_tsq THEN ts_rank(t.search_tsv, v_tsq)
                ELSE 0.05 * word_similarity(v_terms, t.title) END AS score,
           t.created_at, t.id AS task_id, 'task'::text AS acl,
           CASE v_field WHEN 'due' THEN t.due_date WHEN 'completed' THEN t.completed_at ELSE t.created_at END AS eff_date
    FROM public.tasks t
    WHERE t.company_id = v_company AND t.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND t.search_tsv @@ v_tsq) OR word_similarity(v_terms, t.title) >= 0.45)

    UNION ALL
    -- reports (tsv/prefix + ILIKE on type)
    SELECT 'report', r.id, initcap(replace(r.report_type,'_',' ')),
           CASE WHEN v_has THEN ts_headline('english', coalesce(r.parameters::text,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)),
                                            'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE r.status END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq THEN ts_rank(r.search_tsv, v_tsq)
                ELSE 0.04 END,
           r.created_at, NULL::uuid, 'report', r.created_at
    FROM public.reporting_jobs r
    WHERE r.company_id = v_company
      AND (NOT v_has OR (v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq) OR replace(r.report_type,'_',' ') ILIKE v_like)

    UNION ALL
    -- comments (tsv/prefix + ILIKE)
    SELECT 'comment', c.id, left(c.content, 60),
           CASE WHEN v_has THEN ts_headline('english', coalesce(c.content,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)),
                                            'MaxFragments=1,MaxWords=16,MinWords=4')
                ELSE left(c.content, 120) END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq THEN ts_rank(c.search_tsv, v_tsq)
                ELSE 0.04 END,
           c.created_at, c.task_id, 'task', c.created_at
    FROM public.task_comments c
    WHERE c.company_id = v_company AND c.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq) OR c.content ILIKE v_like)

    UNION ALL
    -- filehub files (tsv/prefix + trigram on name)
    SELECT 'file', f.id, f.original_name,
           CASE WHEN v_has THEN ts_headline('english', coalesce(f.caption, f.original_name), COALESCE(v_tsq, plainto_tsquery('english', v_terms)),
                                            'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE coalesce(f.caption,'') END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq THEN ts_rank(f.search_tsv, v_tsq)
                ELSE 0.05 * word_similarity(v_terms, f.original_name) END,
           f.created_at, NULL::uuid, 'filehub', f.created_at
    FROM public.filehub_files f
    WHERE f.company_id = v_company AND f.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq) OR word_similarity(v_terms, f.original_name) >= 0.45)

    UNION ALL
    -- submission / task_brief attachments (name-matched via files_index)
    SELECT 'file', fi.file_id, fi.file_name, fi.file_name,
           0.03::real, fi.created_at, fi.task_id, 'task', fi.created_at
    FROM public.files_index fi
    WHERE fi.company_id = v_company AND fi.source IN ('submission','task_brief')
      AND (NOT v_has OR fi.file_name ILIKE v_like)

    UNION ALL
    -- people (company-scoped like users_select_same_company; terms only, no date)
    SELECT 'person', u.id, COALESCE(u.full_name, u.display_name, u.email),
           NULLIF(concat_ws(' · ', NULLIF(u.job_title,''), NULLIF(u.department,'')), ''),
           GREATEST(
             CASE WHEN u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like THEN 0.6 ELSE 0 END,
             0.4 * word_similarity(v_terms, coalesce(u.full_name, ''))
           )::real,
           u.created_at, NULL::uuid, 'person', u.created_at
    FROM public.users u
    WHERE u.company_id = v_company AND u.deleted_at IS NULL AND v_has
      AND (
        u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like
        OR u.job_title ILIKE v_like OR u.department ILIKE v_like
        OR word_similarity(v_terms, coalesce(u.full_name, '')) >= 0.45
      )
  ),
  filtered AS (
    SELECT * FROM candidates c
    WHERE (p_types IS NULL OR c.type = ANY (p_types))
      AND (p_from IS NULL OR c.eff_date >= p_from)
      AND (p_to   IS NULL OR c.eff_date <= p_to)
    ORDER BY c.score DESC, c.created_at DESC
    LIMIT v_limit * 3
  ),
  allowed AS (
    SELECT * FROM filtered f
    WHERE CASE f.acl
      WHEN 'task'    THEN f.task_id IS NOT NULL AND public.task_list_visible(f.task_id)
      WHEN 'filehub' THEN public.filehub_file_accessible(f.id)
      WHEN 'report'  THEN public.has_permission('report.view')
                          OR COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
      WHEN 'person'  THEN TRUE   -- company members are visible to each other (RLS parity)
      ELSE FALSE
    END
    ORDER BY f.score DESC, f.created_at DESC
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type', a.type, 'id', a.id, 'title', a.title, 'snippet', a.snippet,
    'score', a.score, 'created_at', a.created_at, 'task_id', a.task_id
  ) ORDER BY a.score DESC, a.created_at DESC), '[]'::jsonb)
  INTO v_result FROM allowed a;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_global_search(text, text[], timestamptz, timestamptz, int, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_global_search(text, text[], timestamptz, timestamptz, int, text) TO authenticated;
