-- 20260805_portfolios_table.sql
-- Phase 10 (#191) — the portfolio screen's reader.
--
-- `portfolios` has existed since 20260731_project_hierarchy_1_schema and is
-- written by every bulk instantiation and every spreadsheet import, but has
-- never had a screen. The owner's Phase 10 scope names one: "a portfolio
-- screen, so you can organise your projects even further".
--
-- ── THE LEAK THIS RPC EXISTS TO PREVENT ─────────────────────────────────────
-- portfolios_select is company-wide:
--     company_id = my_company_id() AND deleted_at IS NULL
-- and that is correct for the row itself — a portfolio is a batch label, not
-- sensitive on its own. But a portfolio SCREEN does not show rows, it shows
-- ROLLUPS: "12 projects · 340 tasks · 3 blocked · finishes 12 March". Every
-- one of those numbers is computed over projects, and projects are NOT
-- company-wide readable (#186 made projects_select default-deny, #185 was an
-- escalation through exactly this kind of aggregate).
--
-- Counting straight off `projects` here would therefore hand every member a
-- census of work they cannot open — which is the §16 warning ("every surface
-- is a new place a project can leak") in its most literal form. So every
-- aggregate below is filtered through public.fn_project_accessible(), the
-- same single predicate the other five call sites use, and a portfolio whose
-- projects are ALL invisible to the caller does not appear at all. Two people
-- can legitimately see different project counts for the same portfolio; that
-- is the access model working, not a bug.
--
-- ── THE PORTFOLIO'S PROJECTED END ───────────────────────────────────────────
-- MAX of its projects' projected ends: a batch is finished when its LAST
-- project is, not its average one.
--
-- Confidence is deliberately pessimistic, and the interesting case is a
-- portfolio where some projects can forecast and some cannot. The honest
-- reading of that is "no earlier than X" — a floor, not an estimate — so any
-- non-forecasting project drags the portfolio to 'low'. A portfolio only
-- reaches 'ok' when every contributing project reached 'ok' on its own.
-- Reporting 'ok' from a partial sample is exactly the confident-wrong-date
-- §16.2 rejects.
--
-- ponytail: fn_project_projection runs once per accessible project per call.
-- Fine at the tens-of-projects scale this product runs at; if a company ever
-- carries thousands, this wants a materialised per-project health row
-- refreshed on stage change rather than a LATERAL over the whole list.

CREATE OR REPLACE FUNCTION public.rpc_portfolios_table(
  p_search TEXT    DEFAULT NULL,
  p_limit  INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
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
    -- The access boundary, applied ONCE, here. Everything downstream is an
    -- aggregate over this set and therefore cannot out-report it.
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
      -- Same "blocked" the projects table shows, not a second definition.
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
        -- Any project that cannot forecast, or forecasts weakly, makes the
        -- portfolio date a floor rather than an estimate.
        WHEN COUNT(*) FILTER (WHERE pp.confidence <> 'ok') > 0   THEN 'low'
        ELSE 'ok'
      END AS confidence
    FROM per_project pp
    GROUP BY pp.portfolio_id
  )
  SELECT
    pf.id, pf.name, pf.source, pf.received_at, pf.target_date, pf.created_at,
    pf.template_id, pt.name AS template_name,
    r.projects_total, r.projects_done, r.projects_blocked,
    r.tasks_total, r.tasks_done, r.next_due, r.projected_end, r.confidence
  FROM public.portfolios pf
  JOIN rolled r ON r.portfolio_id = pf.id     -- INNER: no accessible projects, no row
  LEFT JOIN public.project_templates pt ON pt.id = pf.template_id AND pt.deleted_at IS NULL
  WHERE pf.company_id = v_company
    AND pf.deleted_at IS NULL
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
  'Phase 10 (#191) — portfolio list with rollups computed ONLY over projects the caller can access (fn_project_accessible). A portfolio with no accessible projects is not returned.';
