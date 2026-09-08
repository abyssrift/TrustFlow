-- Portfolio reader regression — keep truly empty portfolios visible.
-- A portfolio with non-deleted projects is visible only when at least one of
-- those projects passes fn_project_accessible. A portfolio with no
-- non-deleted projects is a legitimate empty manual portfolio and is returned
-- with zero rollups and confidence `none`.

DROP FUNCTION IF EXISTS public.rpc_portfolios_table(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.rpc_portfolios_table(
  p_search TEXT    DEFAULT NULL,
  p_limit  INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  cover_url        TEXT,
  source           TEXT,
  received_at      TIMESTAMPTZ,
  target_date      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  template_id      UUID,
  template_name    TEXT,
  projects_total   INT,
  projects_done    INT,
  projects_blocked INT,
  tasks_total      INT,
  tasks_done       INT,
  next_due         TIMESTAMPTZ,
  projected_end    DATE,
  confidence       TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company UUID := public.my_company_id();
BEGIN
  IF NOT (
    (SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()) = TRUE
    OR public.has_permission('project.view')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to view portfolios.';
  END IF;

  RETURN QUERY
  WITH visible_projects AS (
    SELECT p.id, p.portfolio_id, p.due_date, p.current_stage_id
    FROM public.projects p
    WHERE p.company_id = v_company
      AND p.deleted_at IS NULL
      AND p.portfolio_id IS NOT NULL
      AND public.fn_project_accessible(p.id)
  ),
  per_project AS (
    SELECT
      vp.portfolio_id,
      vp.id AS project_id,
      vp.due_date,
      COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE) AS project_done,
      COALESCE(pr.blocked, FALSE) AS blocked,
      fp.tasks_total,
      fp.tasks_done,
      fp.projected_end,
      fp.confidence
    FROM visible_projects vp
    LEFT JOIN public.pipeline_stages ps ON ps.id = vp.current_stage_id
    LEFT JOIN public.projects pr ON pr.id = vp.id
    CROSS JOIN LATERAL public.fn_project_projection(vp.id) fp
  ),
  rolled AS (
    SELECT
      pp.portfolio_id,
      COUNT(*)::INT                                             AS projects_total,
      COUNT(*) FILTER (WHERE pp.project_done)::INT              AS projects_done,
      COUNT(*) FILTER (WHERE pp.blocked)::INT                   AS projects_blocked,
      COALESCE(SUM(pp.tasks_total), 0)::INT                     AS tasks_total,
      COALESCE(SUM(pp.tasks_done), 0)::INT                      AS tasks_done,
      MIN(pp.due_date) FILTER (WHERE NOT pp.project_done)       AS next_due,
      MAX(pp.projected_end)                                     AS projected_end,
      CASE
        WHEN COUNT(*) FILTER (WHERE pp.confidence <> 'none') = 0 THEN 'none'
        WHEN COUNT(*) FILTER (WHERE pp.confidence <> 'ok') > 0   THEN 'low'
        ELSE 'ok'
      END AS confidence
    FROM per_project pp
    GROUP BY pp.portfolio_id
  )
  SELECT
    pf.id, pf.name, pf.cover_url, pf.source, pf.received_at, pf.target_date, pf.created_at,
    pf.template_id, pt.name AS template_name,
    COALESCE(r.projects_total, 0)::INT,
    COALESCE(r.projects_done, 0)::INT,
    COALESCE(r.projects_blocked, 0)::INT,
    COALESCE(r.tasks_total, 0)::INT,
    COALESCE(r.tasks_done, 0)::INT,
    r.next_due,
    r.projected_end,
    COALESCE(r.confidence, 'none')::TEXT
  FROM public.portfolios pf
  LEFT JOIN rolled r ON r.portfolio_id = pf.id
  LEFT JOIN public.project_templates pt ON pt.id = pf.template_id AND pt.deleted_at IS NULL
  WHERE pf.company_id = v_company
    AND pf.deleted_at IS NULL
    AND (
      r.portfolio_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.projects p_any
        WHERE p_any.company_id = pf.company_id
          AND p_any.portfolio_id = pf.id
          AND p_any.deleted_at IS NULL
      )
    )
    AND (
      p_search IS NULL OR TRIM(p_search) = ''
      OR pf.name ILIKE '%' || TRIM(p_search) || '%'
      OR COALESCE(pt.name, '') ILIKE '%' || TRIM(p_search) || '%'
    )
  ORDER BY COALESCE(pf.received_at, pf.created_at) DESC
  LIMIT GREATEST(COALESCE(p_limit, 100), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_portfolios_table(TEXT, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.rpc_portfolios_table(TEXT, INTEGER, INTEGER) IS
  'Portfolio list with rollups computed only over projects the caller can access (fn_project_accessible). Truly empty same-company portfolios are returned with zero rollups and confidence none; portfolios containing only inaccessible non-deleted projects are omitted. cover_url included.';
