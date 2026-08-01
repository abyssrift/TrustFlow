-- 20260801_project_visibility.sql
-- Issue #186: project visibility is default-deny, enforced by one predicate,
-- wired into every read path -- not just RLS.
--
-- Plan §11 flagged company-wide `projects_select` as unacceptable once a
-- project carries client identity, a sealed deliverable, and financial
-- rollups. Domain confirmed: an auditor must not see another auditor's
-- engagements, and seeing the ROLLUP NUMBERS without the row contents is
-- itself a leak (completion %, tracked hours, contributor names). So the
-- gate is the project row: either the caller can see it and its rollups are
-- correct, or the row does not exist for them -- no partial/redacted state.
--
-- But #186's real finding is that RLS alone is a no-op here:
--   rpc_projects_table     security_definer = true
--   rpc_project_dashboard  security_definer = true
--   rpc_get_projects       security_definer = true
-- SECURITY DEFINER runs as the function owner, so `projects_select` never
-- fires for any of the three screens a user actually looks at. Tightening
-- the policy alone -- which is what 20260731_project_hierarchy_4_rls_
-- placeholder.sql anticipated -- would change nothing while appearing to
-- fix it. So the same predicate is wired into the policy AND all three
-- RPCs, one function, four call sites, mirroring #163's
-- fn_task_file_accessible (registered in .agents/rules/global-utilities-
-- index.md) which already proved this shape across table RLS, storage RLS
-- and FileHub RPCs.
--
-- A FOURTH SECURITY DEFINER project reader was found while auditing
-- `pg_proc` for every function whose body touches public.projects (not just
-- the three the issue named): `rpc_create_template_from_project`. It reads
-- an arbitrary project by id -- title, description, color, and every task's
-- title/description/category/priority/weight/estimated_hours -- gated only
-- by `project.create` (a role permission every project-creating role holds)
-- or is_owner, with NO per-project accessibility check. That is a real
-- content-disclosure gap under this issue's own threat model ("seeing the
-- numbers is also a leak" applies just as much to seeing task titles via a
-- template capture), so it is wired in here too, as a fifth call site.
--
-- Model (plan §11 / issue #186), reusing existing RBAC instead of a new ACL:
-- a project is visible if the caller is its owner_id, OR is assigned a task
-- in it (directly or via team), OR holds `project.view_all`. Access follows
-- assignment -- no membership table to maintain.
--
-- NOT touched: clients_select / portfolios_select / project_templates_select
-- (the other three policies in the placeholder file this replaces the
-- effect of). Issue #186 enumerates exactly four call sites, all on
-- `projects` -- clients/portfolios/templates visibility is a separate,
-- undecided question (e.g. should a client be visible if ANY of its
-- projects are visible to the caller?) and forcing an answer here would be
-- scope creep past what was asked. They stay on the company-wide
-- placeholder policy, unchanged, exactly as risky/safe as before this
-- migration -- not worse.
--
-- Naming: `project.view_all`, not `project:view_all`. The codebase has a
-- live dot/colon split -- `filehub:view_all_files` uses a colon, but that is
-- an isolated FileHub-only convention (every filehub permission uses a
-- colon). The `project.*` namespace itself (project.view, project.create,
-- project.edit, project.delete, project.archived, project.created,
-- project.restored, project.created_from_template -- see
-- 20260615_project_management_rpc.sql and friends) is 100% dot-notation,
-- zero colon usage. This permission extends that namespace, so it follows
-- it: dot, matching the issue's own suggested name.
--
-- Performance: fn_project_accessible is STABLE (required for the planner to
-- treat it as cacheable/foldable when called once per row in
-- rpc_projects_table). The task-assignment lookup joins tasks.project_id
-- (idx_tasks_project_id, partial WHERE deleted_at IS NULL) into
-- task_assignments.task_id (idx_task_ast_task_id) -- both already indexed,
-- confirmed via pg_indexes before writing this; no new index needed.
-- EXPLAIN (ANALYZE, BUFFERS) before/after is in the issue #186 comment and
-- the PR/commit message, not duplicated here.

-- ── 1. Permission ─────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, description, category) VALUES
    ('project.view_all', 'View All Projects',
     'Bypass project-level ownership/assignment visibility and view every project (and its rollups) across the company.',
     'projects')
ON CONFLICT (key) DO UPDATE
    SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category;

-- Seeded onto the three system roles that plausibly need portfolio-wide
-- visibility (manager/organiser/partner-equivalent). Owner needs no explicit
-- grant -- has_permission() already returns true for every key when
-- users.is_owner, same precedent noted in fn_task_file_accessible -- but is
-- included anyway to match 20260728_filehub_file_view_all_permission.sql's
-- belt-and-suspenders seed.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = true
  AND r.name IN ('Owner', 'Admin', 'Manager')
  AND p.key = 'project.view_all'
ON CONFLICT DO NOTHING;

-- ── 2. The one predicate ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_project_accessible(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_company uuid := public.my_company_id();
  v_owner   uuid;
BEGIN
  -- Floor: must exist, not be deleted, and be in the caller's own company.
  -- This is also what makes project.view_all safe -- it can never see past
  -- this filter, so it is a same-tenant bypass, never a tenant escape.
  SELECT p.owner_id INTO v_owner
  FROM public.projects p
  WHERE p.id = p_project_id
    AND p.deleted_at IS NULL
    AND p.company_id = v_company;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF public.has_permission('project.view_all') THEN
    RETURN true;
  END IF;

  IF v_owner IS NOT NULL AND v_owner = v_uid THEN
    RETURN true;
  END IF;

  -- Assigned a task in the project, directly or via a team. Access follows
  -- assignment -- no membership table to maintain, and a freshly
  -- bulk-created project with no assignments is correctly visible only to
  -- project.view_all holders (unallocated work).
  RETURN EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.task_assignments ta ON ta.task_id = t.id
    WHERE t.project_id = p_project_id
      AND t.deleted_at IS NULL
      AND ( ta.assignee_user_id = v_uid
            OR ta.assignee_team_id IN (
                 SELECT tm.team_id FROM public.team_members tm
                 WHERE tm.user_id = v_uid AND tm.removed_at IS NULL
               ) )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_project_accessible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_project_accessible(uuid) TO authenticated;

-- ── 3. Call site 1: projects_select RLS ──────────────────────────────────
-- Defence in depth + covers direct supabase.from('projects') reads. Does
-- nothing for the three RPCs below (SECURITY DEFINER bypasses RLS by
-- definition) -- that is the whole point of #186.
DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (public.fn_project_accessible(id));

-- ── 4. Call site 2: rpc_projects_table ────────────────────────────────────
-- Same signature/columns/pagination/sort as 20260731_projects_p3_rpc_table.sql
-- (contract is fixed, the UI is built against these exact column names) --
-- the only change is the added accessibility filter in the WHERE clause.
CREATE OR REPLACE FUNCTION public.rpc_projects_table(
  p_search   TEXT    DEFAULT NULL,
  p_stage_id UUID    DEFAULT NULL,
  p_blocked  BOOLEAN DEFAULT NULL,
  p_limit    INT     DEFAULT 100,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE (
  id                      UUID,
  name                    TEXT,
  color                   TEXT,
  client_id               UUID,
  client_name             TEXT,
  portfolio_id            UUID,
  portfolio_name          TEXT,
  current_stage_id        UUID,
  stage_name              TEXT,
  stage_color             TEXT,
  days_in_current_stage   INT,
  due_date                TIMESTAMPTZ,
  days_remaining          INT,
  tasks_total             INT,
  tasks_done              INT,
  weighted_progress       NUMERIC,
  owner_id                UUID,
  owner_name              TEXT,
  owner_avatar_url        TEXT,
  blocked                 BOOLEAN,
  blocked_reason          TEXT,
  tracked_seconds         BIGINT,
  estimated_hours         NUMERIC,
  updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := public.my_company_id();
BEGIN
  IF NOT public.has_permission('project.view') THEN
    RAISE EXCEPTION 'Insufficient permissions to view projects.';
  END IF;

  RETURN QUERY
  WITH stage_age AS (
    SELECT DISTINCT ON (psh.project_id)
      psh.project_id, psh.transitioned_at
    FROM public.project_stage_history psh
    WHERE psh.company_id = v_company_id
    ORDER BY psh.project_id, psh.transitioned_at DESC
  ),
  task_rollup AS (
    SELECT
      t.project_id,
      COUNT(*)::INT AS tasks_total,
      COUNT(*) FILTER (
        WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
      )::INT AS tasks_done,
      COALESCE(SUM(t.weight), 0) AS total_weight,
      COALESCE(SUM(t.weight) FILTER (
        WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
      ), 0) AS completed_weight,
      COALESCE(SUM(t.estimated_hours), 0) AS estimated_hours
    FROM public.tasks t
    LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
    GROUP BY t.project_id
  ),
  time_rollup AS (
    SELECT t.project_id, COALESCE(SUM(ws.total_seconds_spent), 0)::BIGINT AS tracked_seconds
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
    GROUP BY t.project_id
  )
  SELECT
    p.id,
    p.name,
    p.color,
    p.client_id,
    c.name AS client_name,
    p.portfolio_id,
    pf.name AS portfolio_name,
    p.current_stage_id,
    ps.name AS stage_name,
    ps.color AS stage_color,
    (CASE WHEN sa.transitioned_at IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM (now() - sa.transitioned_at))::INT END) AS days_in_current_stage,
    p.due_date,
    (CASE WHEN p.due_date IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM (p.due_date - now()))::INT END) AS days_remaining,
    COALESCE(tr.tasks_total, 0) AS tasks_total,
    COALESCE(tr.tasks_done, 0) AS tasks_done,
    (CASE WHEN COALESCE(tr.total_weight, 0) = 0 THEN 0
          ELSE ROUND(tr.completed_weight / tr.total_weight * 100, 2) END) AS weighted_progress,
    p.owner_id,
    u.full_name AS owner_name,
    u.avatar_url AS owner_avatar_url,
    p.blocked,
    p.blocked_reason,
    COALESCE(tmr.tracked_seconds, 0) AS tracked_seconds,
    COALESCE(tr.estimated_hours, 0) AS estimated_hours,
    p.updated_at
  FROM public.projects p
  LEFT JOIN public.clients c        ON c.id = p.client_id
  LEFT JOIN public.portfolios pf    ON pf.id = p.portfolio_id
  LEFT JOIN public.pipeline_stages ps ON ps.id = p.current_stage_id
  LEFT JOIN public.users u          ON u.id = p.owner_id
  LEFT JOIN stage_age sa            ON sa.project_id = p.id
  LEFT JOIN task_rollup tr          ON tr.project_id = p.id
  LEFT JOIN time_rollup tmr         ON tmr.project_id = p.id
  WHERE p.company_id = v_company_id
    AND p.deleted_at IS NULL
    AND public.fn_project_accessible(p.id)
    AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%')
    AND (p_stage_id IS NULL OR p.current_stage_id = p_stage_id)
    AND (p_blocked IS NULL OR p.blocked = p_blocked)
  ORDER BY days_in_current_stage DESC NULLS LAST, p.id
  LIMIT  LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT) TO authenticated;

-- ── 5. Call site 3: rpc_project_dashboard ────────────────────────────────
-- The accessibility check is folded into the SAME query that already
-- produces "Project not found." for a nonexistent/other-company id, so a
-- denied project and a nonexistent one raise the identical message -- no
-- distinguishing signal, per the issue's "a redacted row still discloses
-- existence" rule.
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
          AND public.fn_project_accessible(p.id)
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

-- ── 6. Call site 4: rpc_get_projects ─────────────────────────────────────
-- This RPC had NO permission/accessibility gate at all before this
-- migration -- not even project.view. The added accessibility filter is
-- what closes it: an inaccessible project is simply excluded from the
-- SETOF, same "absent, not blanked" shape as the other three.
CREATE OR REPLACE FUNCTION public.rpc_get_projects(p_include_archived BOOLEAN DEFAULT false)
RETURNS SETOF public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  RETURN QUERY
  SELECT * FROM public.projects
  WHERE company_id = v_company_id
  AND (p_include_archived OR status != 'archived')
  AND deleted_at IS NULL
  AND public.fn_project_accessible(id)
  ORDER BY is_featured DESC, name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_projects(BOOLEAN) TO authenticated;

-- ── 7. Call site 5 (found, not in the issue's list): rpc_create_template_
--      from_project ────────────────────────────────────────────────────
-- Reads an arbitrary project's full task structure (titles, descriptions,
-- categories, priorities, weights, hours) into a template body, gated only
-- by project.create/is_owner -- no per-project accessibility check. Closed
-- the same way as the other four: folded into the existence check so denied
-- and nonexistent both raise "Project not found."
CREATE OR REPLACE FUNCTION public.rpc_create_template_from_project(p_project_id uuid, p_name text)
RETURNS project_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_project    RECORD;
  v_body       JSONB;
  v_template   public.project_templates;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create templates.';
  END IF;

  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RAISE EXCEPTION 'Template name is required.';
  END IF;

  SELECT * INTO v_project
  FROM public.projects
  WHERE id = p_project_id AND company_id = v_company_id AND deleted_at IS NULL
    AND public.fn_project_accessible(id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'title',            t.title,
    'description',      t.description,
    'pipeline_id',      t.pipeline_id,
    'category',         t.category,
    'priority',         t.priority,
    'weight',           t.weight,
    'estimated_hours',  t.estimated_hours,
    'due_offset_days',  CASE
                           WHEN t.due_date IS NOT NULL AND v_project.start_date IS NOT NULL
                           THEN (t.due_date::date - v_project.start_date::date)
                           ELSE NULL
                        END,
    'assignee_team_id', (
      SELECT ta.assignee_team_id
      FROM public.task_assignments ta
      WHERE ta.task_id = t.id AND ta.assignee_team_id IS NOT NULL
      ORDER BY ta.assigned_at ASC
      LIMIT 1
    )
  ))), '[]'::jsonb)
  INTO v_body
  FROM public.tasks t
  WHERE t.project_id = p_project_id
    AND t.parent_task_id IS NULL
    AND t.deleted_at IS NULL;

  INSERT INTO public.project_templates (company_id, name, description, color, body, created_by)
  VALUES (v_company_id, TRIM(p_name), v_project.description, v_project.color, v_body, v_user_id)
  RETURNING * INTO v_template;

  PERFORM public.log_event(v_company_id, v_user_id, 'project_template', v_template.id, 'project_template.created',
    jsonb_build_object('name', v_template.name, 'source_project_id', p_project_id, 'task_count', jsonb_array_length(v_body)));

  RETURN v_template;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_create_template_from_project(uuid, text) TO authenticated;

-- ── Self-check: wiring only (behavioural proof lives in
--    supabase/checks/20260801_project_visibility_check.sql) ───────────────
DO $$
DECLARE
  v_n         INT;
  v_secdef    BOOLEAN;
  v_volatile  CHAR;
BEGIN
  SELECT count(*) INTO v_n FROM public.permissions WHERE key = 'project.view_all';
  ASSERT v_n = 1, 'project.view_all permission must exist';

  SELECT count(*) INTO v_n
  FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  JOIN public.roles r ON r.id = rp.role_id
  WHERE p.key = 'project.view_all' AND r.is_system;
  ASSERT v_n = 3, format('expected 3 system-role grants (Owner/Admin/Manager), found %s', v_n);

  -- Total on a NULL/nonexistent id -- must never error, always false.
  ASSERT public.fn_project_accessible(NULL) = false, 'fn_project_accessible(NULL) must be false, not an error';
  ASSERT public.fn_project_accessible('00000000-0000-0000-0000-000000000000'::uuid) = false,
    'fn_project_accessible(nonexistent id) must be false';

  SELECT prosecdef, provolatile INTO v_secdef, v_volatile
  FROM pg_proc WHERE proname = 'fn_project_accessible' AND pronamespace = 'public'::regnamespace;
  ASSERT v_secdef AND v_volatile = 's',
    'fn_project_accessible must stay SECURITY DEFINER + STABLE';
END $$;
