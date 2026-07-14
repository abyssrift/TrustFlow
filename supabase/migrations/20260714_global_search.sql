-- Feature: TopBar smart global search (Features.md item #5).
-- Extends the 20260712 federated file search to tasks, reports, comments and
-- filehub files using real Postgres full-text (tsvector + GIN), with a single
-- ranked cross-entity RPC. Access is enforced per row by the existing helpers
-- (task_accessible, filehub_file_accessible); attachments stay name-matched.

-- ── 1. tsvector columns + triggers + GIN indexes ─────────────────────────────

-- tasks: title(A) description(B) category(C)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION public.tasks_search_tsv_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('english', coalesce(NEW.title,'')),       'A')
   || setweight(to_tsvector('english', coalesce(NEW.description,'')), 'B')
   || setweight(to_tsvector('english', coalesce(NEW.category,'')),    'C');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_search_tsv ON public.tasks;
CREATE TRIGGER trg_tasks_search_tsv BEFORE INSERT OR UPDATE OF title, description, category
  ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_search_tsv_update();

CREATE INDEX IF NOT EXISTS idx_tasks_search_tsv ON public.tasks USING GIN (search_tsv);

-- reporting_jobs: report_type(A) parameters(C)
ALTER TABLE public.reporting_jobs ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION public.reporting_jobs_search_tsv_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('english', coalesce(replace(NEW.report_type,'_',' '),'')), 'A')
   || setweight(to_tsvector('english', coalesce(NEW.parameters::text,'')),             'C');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reporting_jobs_search_tsv ON public.reporting_jobs;
CREATE TRIGGER trg_reporting_jobs_search_tsv BEFORE INSERT OR UPDATE OF report_type, parameters
  ON public.reporting_jobs FOR EACH ROW EXECUTE FUNCTION public.reporting_jobs_search_tsv_update();

CREATE INDEX IF NOT EXISTS idx_reporting_jobs_search_tsv ON public.reporting_jobs USING GIN (search_tsv);

-- task_comments: content(B)
ALTER TABLE public.task_comments ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION public.task_comments_search_tsv_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.search_tsv := setweight(to_tsvector('english', coalesce(NEW.content,'')), 'B');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_comments_search_tsv ON public.task_comments;
CREATE TRIGGER trg_task_comments_search_tsv BEFORE INSERT OR UPDATE OF content
  ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.task_comments_search_tsv_update();

CREATE INDEX IF NOT EXISTS idx_task_comments_search_tsv ON public.task_comments USING GIN (search_tsv);

-- filehub_files: original_name(A) caption(B) tags(C)
ALTER TABLE public.filehub_files ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION public.filehub_files_search_tsv_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('english', coalesce(NEW.original_name,'')),                'A')
   || setweight(to_tsvector('english', coalesce(NEW.caption,'')),                      'B')
   || setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags,' '),'')),    'C');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_filehub_files_search_tsv ON public.filehub_files;
CREATE TRIGGER trg_filehub_files_search_tsv BEFORE INSERT OR UPDATE OF original_name, caption, tags
  ON public.filehub_files FOR EACH ROW EXECUTE FUNCTION public.filehub_files_search_tsv_update();

CREATE INDEX IF NOT EXISTS idx_filehub_files_search_tsv ON public.filehub_files USING GIN (search_tsv);

-- One-time backfill. Set search_tsv directly (not the source columns) so we don't
-- fire unrelated audit/activity triggers on these tables.
UPDATE public.tasks SET search_tsv =
     setweight(to_tsvector('english', coalesce(title,'')),       'A')
  || setweight(to_tsvector('english', coalesce(description,'')), 'B')
  || setweight(to_tsvector('english', coalesce(category,'')),    'C');

UPDATE public.reporting_jobs SET search_tsv =
     setweight(to_tsvector('english', coalesce(replace(report_type,'_',' '),'')), 'A')
  || setweight(to_tsvector('english', coalesce(parameters::text,'')),             'C');

UPDATE public.task_comments SET search_tsv =
     setweight(to_tsvector('english', coalesce(content,'')), 'B');

UPDATE public.filehub_files SET search_tsv =
     setweight(to_tsvector('english', coalesce(original_name,'')),             'A')
  || setweight(to_tsvector('english', coalesce(caption,'')),                   'B')
  || setweight(to_tsvector('english', coalesce(array_to_string(tags,' '),'')), 'C');

-- ── 2. rpc_global_search ─────────────────────────────────────────────────────
-- Ranked union over tasks / reports / comments / files. Cheap filters (company,
-- tsv match, date) run first with a candidate over-fetch; per-row access checks
-- run only on survivors (same pattern as rpc_files_search). Supports date-only
-- queries (empty terms + a date range still returns rows, ordered by recency).
CREATE OR REPLACE FUNCTION public.rpc_global_search(
  p_terms text,
  p_types text[]      DEFAULT NULL,   -- subset of ['task','report','comment','file']
  p_from  timestamptz DEFAULT NULL,
  p_to    timestamptz DEFAULT NULL,
  p_limit int         DEFAULT 40
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
  v_result  jsonb;
BEGIN
  -- Need a company and at least one of (terms, date range).
  IF v_company IS NULL OR (NOT v_has AND p_from IS NULL AND p_to IS NULL) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH candidates AS (
    -- tasks
    SELECT 'task'::text AS type, t.id, t.title AS title,
           CASE WHEN v_has THEN ts_headline('english', coalesce(t.description, t.title), v_tsq,
                                            'MaxFragments=1,MaxWords=14,MinWords=4')
                ELSE left(coalesce(t.description,''), 120) END AS snippet,
           CASE WHEN v_has THEN ts_rank(t.search_tsv, v_tsq) ELSE 0 END AS score,
           t.created_at, t.id AS task_id, 'task'::text AS acl
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
           r.created_at, NULL::uuid, 'company'
    FROM public.reporting_jobs r
    WHERE r.company_id = v_company
      AND (NOT v_has OR r.search_tsv @@ v_tsq)

    UNION ALL
    -- comments
    SELECT 'comment', c.id, left(c.content, 60),
           CASE WHEN v_has THEN ts_headline('english', coalesce(c.content,''), v_tsq,
                                            'MaxFragments=1,MaxWords=16,MinWords=4')
                ELSE left(c.content, 120) END,
           CASE WHEN v_has THEN ts_rank(c.search_tsv, v_tsq) ELSE 0 END,
           c.created_at, c.task_id, 'task'
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
           f.created_at, NULL::uuid, 'filehub'
    FROM public.filehub_files f
    WHERE f.company_id = v_company AND f.deleted_at IS NULL
      AND (NOT v_has OR f.search_tsv @@ v_tsq)

    UNION ALL
    -- submission / task_brief attachments (name-matched via files_index)
    SELECT 'file', fi.file_id, fi.file_name, fi.file_name,
           0::real, fi.created_at, fi.task_id, 'task'
    FROM public.files_index fi
    WHERE fi.company_id = v_company
      AND fi.source IN ('submission','task_brief')
      AND (NOT v_has OR fi.file_name ILIKE v_like)
  ),
  filtered AS (
    SELECT * FROM candidates c
    WHERE (p_types IS NULL OR c.type = ANY (p_types))
      AND (p_from IS NULL OR c.created_at >= p_from)
      AND (p_to   IS NULL OR c.created_at <= p_to)
    ORDER BY c.score DESC, c.created_at DESC
    -- ponytail: over-fetch 3x so access filtering can still fill p_limit.
    -- Fine at current scale; GIN indexes cover the tsv match at 10k+ rows.
    LIMIT v_limit * 3
  ),
  allowed AS (
    SELECT * FROM filtered f
    WHERE CASE f.acl
      WHEN 'task'    THEN f.task_id IS NOT NULL AND public.task_accessible(f.task_id)
      WHEN 'filehub' THEN public.filehub_file_accessible(f.id)
      ELSE TRUE   -- 'company': company-scoped rows (reports) visible to members
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

REVOKE EXECUTE ON FUNCTION public.rpc_global_search(text, text[], timestamptz, timestamptz, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_global_search(text, text[], timestamptz, timestamptz, int) TO authenticated;
