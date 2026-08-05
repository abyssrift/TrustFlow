-- Phase 10 (#191, plan §16.6) — projects and portfolios join global search.
--
-- Two parts:
--   1. A `search_tsv` on projects and portfolios so they are indexed the same
--      way tasks/files/comments/reports already are.
--   2. Two new branches in `rpc_global_search`, each with its own `acl`
--      discriminator, because that function is SECURITY DEFINER and RLS does
--      NOT protect it. `projects_select` is default-deny (`fn_project_accessible(id)`),
--      so search must re-apply that predicate explicitly or it becomes the
--      widest hole in the app: it returns rows by name, company-wide, that the
--      user never had on screen. Same shape as #185/#186.
--
-- ponytail: GENERATED ... STORED instead of the trigger+backfill pattern the
-- 20260714 tsv columns use. Postgres maintains it, there is no trigger function
-- to keep in sync and no backfill to forget. Client name is deliberately NOT
-- indexed — it lives on `clients` and a cross-table term would force the old
-- trigger pattern back; add a trigger when someone actually searches by client.

-- ── 1. tsvector columns ──────────────────────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce(name, '')),        'A')
    || setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_projects_search_tsv ON public.projects USING GIN (search_tsv);

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A')) STORED;

CREATE INDEX IF NOT EXISTS idx_portfolios_search_tsv ON public.portfolios USING GIN (search_tsv);

-- ── 2. rpc_global_search: + project / + portfolio ────────────────────────────
-- Signature and return type are UNCHANGED (jsonb), so CREATE OR REPLACE is
-- safe here: no PGRST203 overload, and the existing grants survive.

CREATE OR REPLACE FUNCTION public.rpc_global_search(
  p_terms text,
  p_types text[] DEFAULT NULL::text[],
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 40,
  p_date_field text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.my_company_id();
  v_terms text := trim(COALESCE(p_terms, ''));
  v_has boolean := v_terms <> '';
  v_tsq tsquery;
  v_like text := '%' || v_terms || '%';
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
  v_field text := CASE WHEN p_date_field IN ('due','completed','created') THEN p_date_field ELSE 'created' END;
  v_result jsonb;
BEGIN
  IF v_company IS NULL OR (NOT v_has AND p_from IS NULL AND p_to IS NULL) THEN
    RETURN '[]'::jsonb;
  END IF;
  IF v_has THEN
    v_tsq := websearch_to_tsquery('english', v_terms);
    IF v_tsq IS NOT NULL AND v_tsq::text <> '' THEN
      v_tsq := to_tsquery('english', regexp_replace(v_tsq::text, '''([^'']+)''', '''\1'':*', 'g'));
    END IF;
  END IF;
  WITH candidates AS (
    SELECT 'task'::text AS type, t.id, t.title AS title,
           CASE WHEN v_has THEN ts_headline('english', coalesce(t.description, t.title), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=14,MinWords=4')
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
    SELECT 'report', r.id, initcap(replace(r.report_type,'_',' ')),
           CASE WHEN v_has THEN ts_headline('english', coalesce(r.parameters::text,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE r.status END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq THEN ts_rank(r.search_tsv, v_tsq)
                ELSE 0.04 END,
           r.created_at, NULL::uuid, 'report', r.created_at
    FROM public.reporting_jobs r
    WHERE r.company_id = v_company
      AND (NOT v_has OR (v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq) OR replace(r.report_type,'_',' ') ILIKE v_like)
    UNION ALL
    SELECT 'comment', c.id, left(c.content, 60),
           CASE WHEN v_has THEN ts_headline('english', coalesce(c.content,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=16,MinWords=4')
                ELSE left(c.content, 120) END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq THEN ts_rank(c.search_tsv, v_tsq)
                ELSE 0.04 END,
           c.created_at, c.task_id, 'task', c.created_at
    FROM public.task_comments c
    WHERE c.company_id = v_company AND c.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq) OR c.content ILIKE v_like)
    UNION ALL
    SELECT 'file', f.id, f.original_name,
           CASE WHEN v_has THEN ts_headline('english', coalesce(f.caption, f.original_name), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE coalesce(f.caption,'') END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq THEN ts_rank(f.search_tsv, v_tsq)
                ELSE 0.05 * word_similarity(v_terms, f.original_name) END,
           f.created_at, NULL::uuid, 'filehub', f.created_at
    FROM public.filehub_files f
    WHERE f.company_id = v_company AND f.deleted_at IS NULL AND f.visibility <> 'task'
      AND (NOT v_has OR (v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq) OR word_similarity(v_terms, f.original_name) >= 0.45)
    UNION ALL
    SELECT 'file', fi.file_id, fi.file_name, fi.file_name, 0.03::real, fi.created_at, fi.task_id, 'task', fi.created_at
    FROM public.files_index fi
    WHERE fi.company_id = v_company AND fi.source IN ('submission','task_brief') AND (NOT v_has OR fi.file_name ILIKE v_like)
    UNION ALL
    SELECT 'person', u.id, COALESCE(u.full_name, u.display_name, u.email),
           NULLIF(concat_ws(' · ', NULLIF(u.job_title,''), NULLIF(u.department,'')), ''),
           GREATEST(
             CASE WHEN u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like THEN 0.6 ELSE 0 END,
             0.4 * word_similarity(v_terms, coalesce(u.full_name, ''))
           )::real,
           u.created_at, NULL::uuid, 'person', u.created_at
    FROM public.users u
    WHERE u.company_id = v_company AND u.deleted_at IS NULL AND v_has
      AND (u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like
           OR u.job_title ILIKE v_like OR u.department ILIKE v_like OR word_similarity(v_terms, coalesce(u.full_name, '')) >= 0.45)
    -- ── Phase 10 (#191): projects. `due` targets the project's own due_date;
    -- a project has no completion timestamp, so a `completed` range excludes
    -- them rather than silently answering with created_at.
    UNION ALL
    SELECT 'project', pr.id, pr.name,
           CASE WHEN v_has THEN ts_headline('english', coalesce(pr.description, pr.name), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=14,MinWords=4')
                ELSE left(coalesce(pr.description,''), 120) END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND pr.search_tsv @@ v_tsq THEN ts_rank(pr.search_tsv, v_tsq)
                ELSE 0.05 * word_similarity(v_terms, pr.name) END,
           pr.created_at, NULL::uuid, 'project',
           CASE v_field WHEN 'due' THEN pr.due_date WHEN 'completed' THEN NULL::timestamptz ELSE pr.created_at END
    FROM public.projects pr
    WHERE pr.company_id = v_company AND pr.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND pr.search_tsv @@ v_tsq) OR word_similarity(v_terms, pr.name) >= 0.45)
    -- ── Phase 10 (#191): portfolios. No snippet — the name IS the content, and
    -- a project count here would be a count of projects the caller may not be
    -- allowed to see.
    UNION ALL
    SELECT 'portfolio', pf.id, pf.name, NULL::text,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND pf.search_tsv @@ v_tsq THEN ts_rank(pf.search_tsv, v_tsq)
                ELSE 0.05 * word_similarity(v_terms, pf.name) END,
           pf.created_at, NULL::uuid, 'portfolio',
           CASE v_field WHEN 'due' THEN pf.target_date WHEN 'completed' THEN NULL::timestamptz ELSE pf.created_at END
    FROM public.portfolios pf
    WHERE pf.company_id = v_company AND pf.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND pf.search_tsv @@ v_tsq) OR word_similarity(v_terms, pf.name) >= 0.45)
  ),
  filtered AS (
    SELECT * FROM candidates c
    WHERE (p_types IS NULL OR c.type = ANY (p_types))
      AND (p_from IS NULL OR c.eff_date >= p_from) AND (p_to IS NULL OR c.eff_date <= p_to)
    ORDER BY c.score DESC, c.created_at DESC
    LIMIT v_limit * 3
  ),
  allowed AS (
    SELECT * FROM filtered f
    WHERE CASE f.acl
      WHEN 'task' THEN f.task_id IS NOT NULL AND public.task_list_visible(f.task_id)
      WHEN 'filehub' THEN public.filehub_file_accessible(f.id)
      WHEN 'report' THEN public.has_permission('report.view') OR COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
      WHEN 'person' THEN public.has_permission('user.view_all') OR public.has_permission('role.manage')
      -- §13.14's one predicate, applied here too. Never inline its logic.
      WHEN 'project' THEN public.fn_project_accessible(f.id)
      -- A portfolio is only its projects. If the caller can reach none of them,
      -- the batch name alone still tells them the work exists (#185/#186), so
      -- the portfolio does not exist for them either.
      WHEN 'portfolio' THEN EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.portfolio_id = f.id
          AND p.company_id = v_company
          AND p.deleted_at IS NULL
          AND public.fn_project_accessible(p.id)
      )
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
$function$;

-- Signature unchanged => grants preserved. Assert both, loudly.
DO $$
DECLARE v_n int; v_acl text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'rpc_global_search'
    AND pronamespace = 'public'::regnamespace;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rpc_global_search: expected exactly 1 signature, found % (PGRST203 overload risk)', v_n;
  END IF;
  SELECT array_to_string(proacl, ',') INTO v_acl FROM pg_proc WHERE proname = 'rpc_global_search'
    AND pronamespace = 'public'::regnamespace;
  IF v_acl IS NULL OR v_acl NOT LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'rpc_global_search: authenticated lost EXECUTE (acl=%)', v_acl;
  END IF;
END $$;
