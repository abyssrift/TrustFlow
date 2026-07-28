-- FileHub unification Phase 2 (#151, part of #143): guard read paths against
-- double-counting, then backfill task files as filehub_files pointer rows.
-- Guards are re-emitted BEFORE the backfill in the same migration, so task
-- pointer rows are never visible to a filehub surface that already shows the
-- task file via its own source row.
-- ponytail: analytics stat inflation from task rows is deferred to Phase 4
-- cleanup — it's an internal Insights count, not a user-facing dup.

-- ── Guard 1: files_index filehub branch excludes visibility='task' ───────────
-- (task files still surface via the submission / task_brief branches).
CREATE OR REPLACE VIEW public.files_index AS
SELECT
  'filehub'::text AS source, f.id AS file_id, f.company_id, f.bucket, f.storage_path,
  f.original_name AS file_name, f.mime_type, f.size_bytes, NULL::text AS category,
  f.uploaded_by, f.created_at, NULL::uuid AS task_id, NULL::uuid AS submission_id,
  f.folder_id, f.group_id, f.visibility, NULL::uuid AS project_id, NULL::text AS task_category
FROM public.filehub_files f
WHERE f.deleted_at IS NULL AND f.visibility <> 'task'
UNION ALL
SELECT
  'submission'::text, a.id, a.company_id, 'submission-attachments'::text, a.storage_path,
  a.file_name, a.mime_type, a.file_size, a.category, a.uploaded_by, a.created_at,
  s.task_id, a.submission_id, NULL::uuid, NULL::uuid, NULL::text, t.project_id, t.category
FROM public.submission_attachments a
JOIN public.task_submissions s ON s.id = a.submission_id
LEFT JOIN public.tasks t ON t.id = s.task_id
WHERE s.deleted_at IS NULL AND a.version_id = s.current_version_id
UNION ALL
SELECT
  'task_brief'::text, a.id, a.company_id, 'task-attachments'::text, a.storage_path,
  a.file_name, a.mime_type, a.file_size, a.category, a.uploaded_by, a.created_at,
  a.task_id, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, t.project_id, t.category
FROM public.task_attachments a
LEFT JOIN public.tasks t ON t.id = a.task_id
WHERE a.deleted_at IS NULL;

REVOKE ALL ON public.files_index FROM anon, authenticated;

-- ── Guard 2: global search — its direct filehub_files scan skips 'task' rows ──
-- (they already appear via the files_index submission/task_brief file branch).
CREATE OR REPLACE FUNCTION public.rpc_global_search(p_terms text, p_types text[] DEFAULT NULL::text[], p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40, p_date_field text DEFAULT NULL::text)
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

-- ── Backfill: briefs ─────────────────────────────────────────────────────────
WITH ins AS (
  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, task_id, created_at)
  SELECT a.company_id, COALESCE(a.uploaded_by, t.created_by, t.manager_id),
         a.storage_path, 'task-attachments', a.file_name, a.mime_type, COALESCE(a.file_size, 0), 'task', a.task_id, a.created_at
  FROM public.task_attachments a
  JOIN public.tasks t ON t.id = a.task_id
  WHERE a.deleted_at IS NULL AND a.storage_path IS NOT NULL AND a.filehub_file_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.filehub_files f WHERE f.company_id = a.company_id AND f.bucket = 'task-attachments' AND f.storage_path = a.storage_path)
  RETURNING id, company_id, storage_path
)
UPDATE public.task_attachments a SET filehub_file_id = ins.id
FROM ins WHERE a.company_id = ins.company_id AND a.storage_path = ins.storage_path AND a.filehub_file_id IS NULL;

-- Link any already-existing pointer rows (idempotent re-run safety).
UPDATE public.task_attachments a SET filehub_file_id = f.id
FROM public.filehub_files f
WHERE a.filehub_file_id IS NULL AND a.storage_path IS NOT NULL
  AND f.company_id = a.company_id AND f.bucket = 'task-attachments' AND f.storage_path = a.storage_path AND f.visibility = 'task';

-- ── Backfill: submissions (current-version attachments) ──────────────────────
WITH ins AS (
  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, task_id, created_at)
  SELECT a.company_id, COALESCE(a.uploaded_by, s.submitted_by),
         a.storage_path, 'submission-attachments', a.file_name, a.mime_type, COALESCE(a.file_size, 0), 'task', s.task_id, a.created_at
  FROM public.submission_attachments a
  JOIN public.task_submissions s ON s.id = a.submission_id
  WHERE s.deleted_at IS NULL AND a.version_id = s.current_version_id
    AND a.storage_path IS NOT NULL AND a.filehub_file_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.filehub_files f WHERE f.company_id = a.company_id AND f.bucket = 'submission-attachments' AND f.storage_path = a.storage_path)
  RETURNING id, company_id, storage_path
)
UPDATE public.submission_attachments a SET filehub_file_id = ins.id
FROM ins WHERE a.company_id = ins.company_id AND a.storage_path = ins.storage_path AND a.filehub_file_id IS NULL;

UPDATE public.submission_attachments a SET filehub_file_id = f.id
FROM public.filehub_files f
WHERE a.filehub_file_id IS NULL AND a.storage_path IS NOT NULL
  AND f.company_id = a.company_id AND f.bucket = 'submission-attachments' AND f.storage_path = a.storage_path AND f.visibility = 'task';
