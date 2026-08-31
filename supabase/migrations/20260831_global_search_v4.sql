-- #318 — fix broken similarity ("did you mean") search in global search.
--
-- rpc_global_search already had a fuzzy path, it just never survived to the
-- caller. Three root causes, all in this one function:
--
--   A. INCOMPARABLE SCORE SCALES. Exact (tsvector) hits scored ts_rank
--      (~0..0.8). Fuzzy hits scored `0.05 * word_similarity` (~0.02..0.05).
--      A fuzzy row could never out-rank an exact row — fine — but it also sat
--      *below every 0.04 flat-scored ILIKE hit*, and the numbers meant nothing
--      relative to each other. Now: exact => 1.0 + ts_rank (always >= 1.0),
--      fuzzy => raw word_similarity (0.35..1.0). One monotonic 0..1.8 scale.
--
--   B. FUZZY ROWS CUT BEFORE ACL. `filtered` took a single
--      `ORDER BY score DESC LIMIT v_limit*3` over the whole candidate pool
--      *before* the ACL CTE. Any tenant with >= v_limit*3 exact hits for a
--      term (e.g. "review" — 100+ tasks) pushed every fuzzy row out of that
--      slice, so ACL never saw them and the caller never got a "did you mean".
--      Now `filtered` is two independent slices — an exact slice and a fuzzy
--      slice — each with its own LIMIT, UNION ALL'd, so a wall of exact hits
--      can't starve the fuzzy rows. Type + date filters are applied in
--      `scoped` *before* both slices so a type-scoped query still fills the
--      fuzzy slice with the right type.
--
--   C. reports / comments / files_index had no fuzzy path at all — ILIKE
--      substring only, flat 0.04 score. They now get a `word_similarity`
--      branch on report_type / content / file_name like every other entity.
--
--   D. The trigram GIN indexes (idx_tasks_title_trgm, idx_filehub_name_trgm,
--      idx_users_full_name_trgm) were dead: the function called
--      `word_similarity(a,b) >= 0.45` (function form) in every WHERE, which no
--      index can answer, and pg_trgm.word_similarity_threshold (0.6 default)
--      was likewise unused. Fuzzy WHERE predicates now use the `<%` operator,
--      and the threshold is pinned to 0.35 in the function's SET clause, so the
--      indexes participate and the cutoff matches what the scoring expressions
--      expect. `word_similarity` calls remain only in SELECT-list score
--      expressions, never in WHERE.
--      + two missing GIN indexes for projects.name / portfolios.name.
--
-- Signature and return type UNCHANGED (jsonb) => CREATE OR REPLACE is safe,
-- no PGRST203 overload, grants survive. Asserted at the bottom.

-- Force-load the pg_trgm shared library in this session so
-- `pg_trgm.word_similarity_threshold` is a registered USERSET GUC *before* the
-- CREATE FUNCTION below pins it in the function's SET clause. Without this,
-- a non-superuser (Supabase migrations run as `postgres`, which is NOT a
-- superuser) hits "permission denied to set parameter" on what is still an
-- unregistered placeholder.
SELECT 'x' <% 'y';

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
-- #318 (D): the fuzzy WHERE predicates below use the `<%` operator so the
-- trigram GIN indexes are usable; `<%` reads its cutoff from this GUC, which
-- was left at the 0.6 default and dead.
-- Threshold choice — tuned 0.45 -> 0.35 (#318): a short word with a single
-- mid-word typo (e.g. `upwark` -> `upwork`) scores word_similarity ~0.43, so
-- the first-pass 0.45 cutoff was excluding exactly the real typo matches this
-- "did you mean" path exists to surface. 0.35 lets those through and still
-- adds no noise on current data — unrelated short words score ~0.1.
-- NOTE: this lives in the function's SET clause, not as a `SET LOCAL` in the
-- body — Postgres rejects `SET` inside a STABLE (non-volatile) function
-- ("SET is not allowed in a non-volatile function"). The SET clause is the
-- supported form and auto-restores the GUC on function exit.
SET pg_trgm.word_similarity_threshold TO '0.35'
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
    -- ── task: exact (tsvector) OR fuzzy (title trigram) ───────────────────
    SELECT 'task'::text AS type, t.id, t.title AS title,
           CASE WHEN v_has THEN ts_headline('english', coalesce(t.description, t.title), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=14,MinWords=4')
                ELSE left(coalesce(t.description,''), 120) END AS snippet,
           (CASE WHEN NOT v_has THEN 0::real
                 WHEN v_tsq IS NOT NULL AND t.search_tsv @@ v_tsq THEN 1.0 + ts_rank(t.search_tsv, v_tsq)
                 ELSE word_similarity(v_terms, t.title) END)::real AS score,
           t.created_at, t.id AS task_id, 'task'::text AS acl,
           CASE v_field WHEN 'due' THEN t.due_date WHEN 'completed' THEN t.completed_at ELSE t.created_at END AS eff_date
    FROM public.tasks t
    WHERE t.company_id = v_company AND t.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND t.search_tsv @@ v_tsq) OR v_terms <% t.title)
    UNION ALL
    -- ── report: exact tsvector OR ILIKE substring OR fuzzy report_type ────
    SELECT 'report', r.id, initcap(replace(r.report_type,'_',' ')),
           CASE WHEN v_has THEN ts_headline('english', coalesce(r.parameters::text,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE r.status END,
           (CASE WHEN NOT v_has THEN 0::real
                 WHEN v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq THEN 1.0 + ts_rank(r.search_tsv, v_tsq)
                 WHEN replace(r.report_type,'_',' ') ILIKE v_like THEN 1.0
                 ELSE word_similarity(v_terms, replace(r.report_type,'_',' ')) END)::real,
           r.created_at, NULL::uuid, 'report', r.created_at
    FROM public.reporting_jobs r
    WHERE r.company_id = v_company
      AND (NOT v_has OR (v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq)
           OR replace(r.report_type,'_',' ') ILIKE v_like
           OR v_terms <% replace(r.report_type,'_',' '))
    UNION ALL
    -- ── comment: exact tsvector OR ILIKE substring OR fuzzy content ───────
    SELECT 'comment', c.id, left(c.content, 60),
           CASE WHEN v_has THEN ts_headline('english', coalesce(c.content,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=16,MinWords=4')
                ELSE left(c.content, 120) END,
           (CASE WHEN NOT v_has THEN 0::real
                 WHEN v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq THEN 1.0 + ts_rank(c.search_tsv, v_tsq)
                 WHEN c.content ILIKE v_like THEN 1.0
                 ELSE word_similarity(v_terms, c.content) END)::real,
           c.created_at, c.task_id, 'task', c.created_at
    FROM public.task_comments c
    WHERE c.company_id = v_company AND c.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq)
           OR c.content ILIKE v_like
           OR v_terms <% c.content)
    UNION ALL
    -- ── filehub file: exact tsvector OR fuzzy original_name ──────────────
    SELECT 'file', f.id, f.original_name,
           CASE WHEN v_has THEN ts_headline('english', coalesce(f.caption, f.original_name), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE coalesce(f.caption,'') END,
           (CASE WHEN NOT v_has THEN 0::real
                 WHEN v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq THEN 1.0 + ts_rank(f.search_tsv, v_tsq)
                 ELSE word_similarity(v_terms, f.original_name) END)::real,
           f.created_at, NULL::uuid, 'filehub', f.created_at
    FROM public.filehub_files f
    WHERE f.company_id = v_company AND f.deleted_at IS NULL AND f.visibility <> 'task'
      AND (NOT v_has OR (v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq) OR v_terms <% f.original_name)
    UNION ALL
    -- ── files_index (submission / task_brief): ILIKE OR fuzzy file_name ──
    SELECT 'file', fi.file_id, fi.file_name, fi.file_name,
           (CASE WHEN NOT v_has THEN 0::real
                 WHEN fi.file_name ILIKE v_like THEN 1.0
                 ELSE word_similarity(v_terms, fi.file_name) END)::real,
           fi.created_at, fi.task_id, 'task', fi.created_at
    FROM public.files_index fi
    WHERE fi.company_id = v_company AND fi.source IN ('submission','task_brief')
      AND (NOT v_has OR fi.file_name ILIKE v_like OR v_terms <% fi.file_name)
    UNION ALL
    -- ── person: any ILIKE field hit => 1.0, else fuzzy full_name ─────────
    SELECT 'person', u.id, COALESCE(u.full_name, u.display_name, u.email),
           NULLIF(concat_ws(' · ', NULLIF(u.job_title,''), NULLIF(u.department,'')), ''),
           (CASE WHEN u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like
                      OR u.job_title ILIKE v_like OR u.department ILIKE v_like THEN 1.0
                 ELSE word_similarity(v_terms, coalesce(u.full_name, '')) END)::real,
           u.created_at, NULL::uuid, 'person', u.created_at
    FROM public.users u
    WHERE u.company_id = v_company AND u.deleted_at IS NULL AND v_has
      AND (u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like
           OR u.job_title ILIKE v_like OR u.department ILIKE v_like
           OR v_terms <% coalesce(u.full_name, ''))
    -- ── Phase 10 (#191): projects. `due` targets the project's own due_date;
    -- a project has no completion timestamp, so a `completed` range excludes
    -- them rather than silently answering with created_at.
    UNION ALL
    SELECT 'project', pr.id, pr.name,
           CASE WHEN v_has THEN ts_headline('english', coalesce(pr.description, pr.name), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=14,MinWords=4')
                ELSE left(coalesce(pr.description,''), 120) END,
           (CASE WHEN NOT v_has THEN 0::real
                 WHEN v_tsq IS NOT NULL AND pr.search_tsv @@ v_tsq THEN 1.0 + ts_rank(pr.search_tsv, v_tsq)
                 ELSE word_similarity(v_terms, pr.name) END)::real,
           pr.created_at, NULL::uuid, 'project',
           CASE v_field WHEN 'due' THEN pr.due_date WHEN 'completed' THEN NULL::timestamptz ELSE pr.created_at END
    FROM public.projects pr
    WHERE pr.company_id = v_company AND pr.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND pr.search_tsv @@ v_tsq) OR v_terms <% pr.name)
    -- ── Phase 10 (#191): portfolios. No snippet — the name IS the content.
    UNION ALL
    SELECT 'portfolio', pf.id, pf.name, NULL::text,
           (CASE WHEN NOT v_has THEN 0::real
                 WHEN v_tsq IS NOT NULL AND pf.search_tsv @@ v_tsq THEN 1.0 + ts_rank(pf.search_tsv, v_tsq)
                 ELSE word_similarity(v_terms, pf.name) END)::real,
           pf.created_at, NULL::uuid, 'portfolio',
           CASE v_field WHEN 'due' THEN pf.target_date WHEN 'completed' THEN NULL::timestamptz ELSE pf.created_at END
    FROM public.portfolios pf
    WHERE pf.company_id = v_company AND pf.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND pf.search_tsv @@ v_tsq) OR v_terms <% pf.name)
  ),
  -- Type + date filters BEFORE the slices so a type/date-scoped query fills
  -- the fuzzy slice with in-scope rows, not wrong-type rows that ACL/return
  -- then drop to zero.
  scoped AS (
    SELECT * FROM candidates c
    WHERE (p_types IS NULL OR c.type = ANY (p_types))
      AND (p_from IS NULL OR c.eff_date >= p_from) AND (p_to IS NULL OR c.eff_date <= p_to)
  ),
  -- #318 (B): two independent slices. The exact slice can't starve the fuzzy
  -- slice no matter how many exact hits a term has.
  -- ponytail: still over-fetches up to v_limit*4 rows pre-ACL, same as before.
  -- The real fix is applying ACL before the limit (so a page of hidden rows
  -- can't crowd out visible ones) — explicitly out of scope for #318.
  filtered AS (
    ( SELECT * FROM scoped WHERE score >= 1.0
      ORDER BY score DESC, created_at DESC LIMIT v_limit * 3 )
    UNION ALL
    -- score < 1.0 also carries browse mode (no terms, date range only): every
    -- candidate then scores 0, and this slice keeps the old v_limit*3 recents.
    ( SELECT * FROM scoped WHERE score < 1.0
      ORDER BY score DESC, created_at DESC
      LIMIT CASE WHEN v_has THEN v_limit ELSE v_limit * 3 END )
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

-- #318 (D): the two trigram indexes that never existed. Plain CREATE INDEX,
-- not CONCURRENTLY — this migration runs in a transaction (same as how
-- 20260808 added idx_projects_search_tsv / idx_portfolios_search_tsv).
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm   ON public.projects   USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_portfolios_name_trgm ON public.portfolios USING gin (name gin_trgm_ops);

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
