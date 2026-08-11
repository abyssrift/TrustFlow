-- 20260811_portfolios_cover_picture.sql
-- Issue #259 — a portfolio can carry a company/client picture instead of only
-- its derived glyph. Three pieces:
--   1. portfolios.cover_url (nullable; NULL keeps the derived cover)
--   2. a public `portfolio-covers` bucket with company-scoped RLS
--   3. rpc_update_portfolio — SECURITY DEFINER, like every other portfolio
--      write (portfolios has NO update policy; writes go through RPCs)
-- and the reader rpc_portfolios_table now returns cover_url so the grid and
-- the scoped header can render the image.

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- ── portfolio-covers bucket ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection, owner, created_at, updated_at)
VALUES (
  'portfolio-covers',
  'portfolio-covers',
  true,
  5242880,  -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  false,
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access for portfolio covers" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'portfolio-covers')
;

-- Path scheme is {portfolio_id}/{timestamp}.{ext} — path_tokens[1] is the
-- portfolio, and the policy only lets a user write covers for a portfolio in
-- their own company. Same company-scoping as company-logos, keyed on the
-- portfolio instead of the company.
CREATE POLICY "Allow users to upload portfolio covers" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'portfolio-covers'
    AND EXISTS (
      SELECT 1 FROM public.portfolios p
      JOIN public.users u ON u.id = auth.uid()
      WHERE p.id = path_tokens[1]::uuid
        AND p.company_id = u.company_id
        AND p.deleted_at IS NULL
    )
  )
;

CREATE POLICY "Allow users to update portfolio covers" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'portfolio-covers'
    AND EXISTS (
      SELECT 1 FROM public.portfolios p
      JOIN public.users u ON u.id = auth.uid()
      WHERE p.id = path_tokens[1]::uuid
        AND p.company_id = u.company_id
        AND p.deleted_at IS NULL
    )
  )
;

CREATE POLICY "Allow users to delete portfolio covers" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'portfolio-covers'
    AND EXISTS (
      SELECT 1 FROM public.portfolios p
      JOIN public.users u ON u.id = auth.uid()
      WHERE p.id = path_tokens[1]::uuid
        AND p.company_id = u.company_id
        AND p.deleted_at IS NULL
    )
  )
;

-- ── rpc_update_portfolio ────────────────────────────────────────────────────
-- The only edit door for portfolios (name / target date / cover picture).
-- SECURITY DEFINER with the same permission gate the portfolio screen uses
-- (owner, or project.edit — the same bar project rename uses), scoped to the
-- caller's company, so no member can touch another company's batch.
CREATE OR REPLACE FUNCTION public.rpc_update_portfolio(
  p_portfolio_id UUID,
  p_name         TEXT,
  p_target_date  TIMESTAMPTZ,
  p_cover_url    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company UUID := public.my_company_id();
  v_name    TEXT  := NULLIF(TRIM(p_name), '');
BEGIN
  IF NOT (
    (SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()) = TRUE
    OR public.has_permission('project.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit this portfolio.';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Portfolio name is required.';
  END IF;

  UPDATE public.portfolios
  SET name        = v_name,
      target_date = p_target_date,
      cover_url   = p_cover_url,
      updated_at  = now()
  WHERE id = p_portfolio_id
    AND company_id = v_company
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portfolio not found.';
  END IF;

  RETURN jsonb_build_object(
    'id',          p_portfolio_id,
    'name',        v_name,
    'target_date', p_target_date,
    'cover_url',   p_cover_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_update_portfolio(UUID, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

COMMENT ON FUNCTION public.rpc_update_portfolio(UUID, TEXT, TIMESTAMPTZ, TEXT) IS
  'Issue #259 — edit a portfolio name / target date / cover picture. SECURITY DEFINER because portfolios has no UPDATE RLS policy; all writes go through RPCs.';

-- ── rpc_portfolios_table: return cover_url ──────────────────────────────────
-- Full re-create of 20260805_portfolios_table.sql with cover_url added to the
-- output, so the grid card and the scoped header can render the image. Column
-- order in RETURNS TABLE and the RETURN QUERY SELECT must stay in lock-step.
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
    r.projects_total, r.projects_done, r.projects_blocked,
    r.tasks_total, r.tasks_done, r.next_due, r.projected_end, r.confidence
  FROM public.portfolios pf
  JOIN rolled r ON r.portfolio_id = pf.id
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
  'Phase 10 (#191) — portfolio list with rollups computed ONLY over projects the caller can access (fn_project_accessible). A portfolio with no accessible projects is not returned. cover_url added for #259.';
