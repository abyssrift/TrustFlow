-- Feature C (C1–C2): federated file index + cross-app search
-- C1: files_index — plain normalization view over the three file sources.
-- No access enforcement here (the three sources gate differently); the view is
-- not exposed to API roles — access is enforced by rpc_files_search only.

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
  f.visibility
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
  NULL::text
FROM public.submission_attachments a
JOIN public.task_submissions s ON s.id = a.submission_id
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
  NULL::text
FROM public.task_attachments a
WHERE a.deleted_at IS NULL;

-- The view runs with its owner's rights (bypasses source-table RLS), so it must
-- not be directly selectable through the Data API.
REVOKE ALL ON public.files_index FROM anon, authenticated;

-- Task-access helper: the exact predicate from the top of rpc_get_task_details
-- (assignee OR team-assignee OR manager OR creator OR owner OR task.view_detail),
-- company-scoped. No existing helper covered this (verified pg_proc 2026-07-12).
CREATE OR REPLACE FUNCTION public.task_accessible(p_task_id uuid)
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
        COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
        OR t.created_by = auth.uid()
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
        OR public.has_permission('task.view_detail')
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.task_accessible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_accessible(uuid) TO authenticated;

-- C2: cross-source search. Cheap filters (company + query + source/task) run
-- first with a candidate LIMIT; per-row access checks run only on survivors.
CREATE OR REPLACE FUNCTION public.rpc_files_search(
  p_query   text,
  p_sources text[] DEFAULT NULL,
  p_task_id uuid   DEFAULT NULL,
  p_limit   int    DEFAULT 50
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
  v_limit   int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_result  jsonb;
BEGIN
  IF v_company IS NULL OR v_q = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source',        r.source,
    'file_id',       r.file_id,
    'bucket',        r.bucket,
    'storage_path',  r.storage_path,
    'file_name',     r.file_name,
    'mime_type',     r.mime_type,
    'size_bytes',    r.size_bytes,
    'category',      r.category,
    'uploaded_by',   r.uploaded_by,
    'created_at',    r.created_at,
    'task_id',       r.task_id,
    'submission_id', r.submission_id,
    'task_title',    CASE WHEN r.task_id IS NOT NULL
                          THEN (SELECT t.title FROM public.tasks t WHERE t.id = r.task_id)
                     END,
    'folder_id',     r.folder_id,
    'group_id',      r.group_id,
    'visibility',    r.visibility
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT c.*
    FROM (
      SELECT fi.*
      FROM public.files_index fi
      WHERE fi.company_id = v_company
        AND (p_sources IS NULL OR fi.source = ANY (p_sources))
        AND (p_task_id IS NULL OR fi.task_id = p_task_id)
        AND (
          fi.file_name ILIKE '%' || v_q || '%'
          OR (fi.source = 'filehub' AND EXISTS (
            SELECT 1 FROM public.filehub_files ff
            WHERE ff.id = fi.file_id
              AND (
                ff.caption ILIKE '%' || v_q || '%'
                OR array_to_string(ff.tags, ' ') ILIKE '%' || v_q || '%'
              )
          ))
        )
      ORDER BY fi.created_at DESC
      -- ponytail: over-fetch 3x so access filtering can still fill p_limit;
      -- heuristic, fine at ~120 files — revisit with pg_trgm when tables hit ~10k+.
      LIMIT v_limit * 3
    ) c
    WHERE CASE
      WHEN c.source = 'filehub' THEN public.filehub_file_accessible(c.file_id)
      ELSE public.task_accessible(c.task_id)
    END
    ORDER BY c.created_at DESC
    LIMIT v_limit
  ) r;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_files_search(text, text[], uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_files_search(text, text[], uuid, int) TO authenticated;
