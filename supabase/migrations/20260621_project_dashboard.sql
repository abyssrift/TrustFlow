-- 20260621_project_dashboard.sql
-- Tier 3 Phase 3: comprehensive single-project metrics for the desktop
-- Project Details dashboard. Company-scoped via my_company_id(); gated by
-- the project.view permission. Returns one JSONB blob with everything the
-- multi-column dashboard renders.

CREATE OR REPLACE FUNCTION public.rpc_project_dashboard(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id   UUID := public.my_company_id();
    v_project      JSONB;
    v_totals       JSONB;
    v_by_priority  JSONB;
    v_by_stage     JSONB;
    v_by_category  JSONB;
    v_contributors JSONB;
    v_recent       JSONB;
    v_due_soon     JSONB;
BEGIN
    IF NOT public.has_permission('project.view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view projects.';
    END IF;

    SELECT to_jsonb(x) INTO v_project FROM (
        SELECT p.id, p.name, p.description, p.status, p.expiry_date, p.is_featured, p.created_at
        FROM public.projects p
        WHERE p.id = p_project_id AND p.company_id = v_company_id
    ) x;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Project not found.';
    END IF;

    -- ── Totals ───────────────────────────────────────────────────────────────
    SELECT jsonb_build_object(
        'total',     COUNT(*),
        'completed', COUNT(*) FILTER (WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)),
        'overdue',   COUNT(*) FILTER (WHERE t.due_date < now() AND NOT COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)),
        'active',    COUNT(*) FILTER (WHERE NOT COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)),
        'completion_rate', CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE))::numeric / COUNT(*) * 100, 1)
            ELSE 0 END,
        'total_weight',     COALESCE(SUM(t.weight), 0),
        'completed_weight', COALESCE(SUM(t.weight) FILTER (WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)), 0),
        'est_hours',        COALESCE(SUM(t.estimated_hours), 0)
    )
    INTO v_totals
    FROM public.tasks t
    LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.project_id = p_project_id AND t.deleted_at IS NULL;

    SELECT v_totals || jsonb_build_object('tracked_seconds', COALESCE(SUM(ws.total_seconds_spent), 0))
    INTO v_totals
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
    WHERE t.project_id = p_project_id AND t.deleted_at IS NULL;

    -- ── By priority ──────────────────────────────────────────────────────────
    SELECT COALESCE(jsonb_agg(jsonb_build_object('priority', q.pr, 'count', q.cnt) ORDER BY q.sort_order), '[]'::jsonb)
    INTO v_by_priority
    FROM (
        SELECT COALESCE(t.priority, 'medium') AS pr, COUNT(*) AS cnt,
               CASE COALESCE(t.priority, 'medium')
                   WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END AS sort_order
        FROM public.tasks t
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
        GROUP BY COALESCE(t.priority, 'medium')
    ) q;

    -- ── By stage (pipeline distribution) ─────────────────────────────────────
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'stage_id', ps.id, 'name', ps.name, 'color', ps.color, 'position', ps.position,
        'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type, 'count', q.cnt
    ) ORDER BY ps.position), '[]'::jsonb)
    INTO v_by_stage
    FROM (
        SELECT t.current_stage_id AS sid, COUNT(*) AS cnt
        FROM public.tasks t
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.current_stage_id IS NOT NULL
        GROUP BY t.current_stage_id
    ) q
    JOIN public.pipeline_stages ps ON ps.id = q.sid;

    -- ── By category (top 8) ──────────────────────────────────────────────────
    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', q.cat, 'count', q.cnt) ORDER BY q.cnt DESC), '[]'::jsonb)
    INTO v_by_category
    FROM (
        SELECT COALESCE(NULLIF(trim(t.category), ''), 'Uncategorized') AS cat, COUNT(*) AS cnt
        FROM public.tasks t
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
        GROUP BY COALESCE(NULLIF(trim(t.category), ''), 'Uncategorized')
        ORDER BY cnt DESC
        LIMIT 8
    ) q;

    -- ── Contributors (by tracked time, top 6) ────────────────────────────────
    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.secs DESC, t.tasks DESC), '[]'::jsonb)
    INTO v_contributors
    FROM (
        SELECT jsonb_build_object(
                   'user_id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url,
                   'tracked_seconds', COALESCE(SUM(ws.total_seconds_spent), 0),
                   'tasks', COUNT(DISTINCT ws.task_id)
               ) AS row,
               COALESCE(SUM(ws.total_seconds_spent), 0) AS secs,
               COUNT(DISTINCT ws.task_id) AS tasks
        FROM public.task_work_sessions ws
        JOIN public.tasks tk ON tk.id = ws.task_id
        JOIN public.users u  ON u.id = ws.user_id
        WHERE tk.project_id = p_project_id AND tk.deleted_at IS NULL
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY secs DESC, tasks DESC
        LIMIT 6
    ) t;

    -- ── Recent tasks (last 8 created) ────────────────────────────────────────
    SELECT COALESCE(jsonb_agg(r.row ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM (
        SELECT jsonb_build_object(
                   'id', t.id, 'title', t.title, 'priority', t.priority,
                   'stage_name', ps.name, 'stage_color', ps.color,
                   'due_date', t.due_date, 'created_at', t.created_at,
                   'is_complete', COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
               ) AS row, t.created_at
        FROM public.tasks t
        LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
        ORDER BY t.created_at DESC
        LIMIT 8
    ) r;

    -- ── Upcoming deadlines (incomplete, soonest first) ───────────────────────
    SELECT COALESCE(jsonb_agg(r.row ORDER BY r.due_date ASC), '[]'::jsonb)
    INTO v_due_soon
    FROM (
        SELECT jsonb_build_object(
                   'id', t.id, 'title', t.title, 'due_date', t.due_date,
                   'stage_name', ps.name, 'overdue', (t.due_date < now())
               ) AS row, t.due_date
        FROM public.tasks t
        LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
          AND t.due_date IS NOT NULL
          AND NOT COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
        ORDER BY t.due_date ASC
        LIMIT 5
    ) r;

    RETURN jsonb_build_object(
        'project',      v_project,
        'totals',       COALESCE(v_totals, '{}'::jsonb),
        'by_priority',  COALESCE(v_by_priority, '[]'::jsonb),
        'by_stage',     COALESCE(v_by_stage, '[]'::jsonb),
        'by_category',  COALESCE(v_by_category, '[]'::jsonb),
        'contributors', COALESCE(v_contributors, '[]'::jsonb),
        'recent_tasks', COALESCE(v_recent, '[]'::jsonb),
        'due_soon',     COALESCE(v_due_soon, '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_project_dashboard(UUID) TO authenticated;
