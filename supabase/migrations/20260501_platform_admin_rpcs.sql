-- ====================================================================
-- Platform Admin RPCs — Cross-tenant monitoring (platform owner only)
-- All functions validate the caller is the TrustFlow platform owner
-- before returning any data.
-- ====================================================================

-- ── 1. rpc_platform_companies_overview ──────────────────────────────
-- Returns all tenant companies with aggregate usage metrics.
DROP FUNCTION IF EXISTS public.rpc_platform_companies_overview();
CREATE OR REPLACE FUNCTION public.rpc_platform_companies_overview()
RETURNS TABLE (
  id                   UUID,
  name                 TEXT,
  created_at           TIMESTAMPTZ,
  user_count           BIGINT,
  task_count           BIGINT,
  session_minutes_week BIGINT,
  active_sessions_now  BIGINT,
  last_active_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email NOT IN ('adamsamir2005@gmail.com', 'adam.samir@trustedgellc.com', 'adamsamir@hotmail.com') THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cu AS (
    SELECT u.company_id, u.id AS user_id
    FROM public.users u
    WHERE u.company_id IS NOT NULL
  ),
  task_counts AS (
    SELECT cu.company_id, COUNT(DISTINCT t.id) AS cnt
    FROM public.tasks t
    JOIN cu ON cu.user_id = t.manager_id
    GROUP BY cu.company_id
  ),
  sessions_week AS (
    SELECT
      cu.company_id,
      COALESCE(SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::BIGINT, 0) AS mins,
      MAX(tws.last_heartbeat_at) AS last_at
    FROM public.task_work_sessions tws
    JOIN cu ON cu.user_id = tws.user_id
    WHERE tws.started_at >= NOW() - INTERVAL '7 days'
    GROUP BY cu.company_id
  ),
  sessions_now AS (
    SELECT cu.company_id, COUNT(DISTINCT tws.id) AS cnt
    FROM public.task_work_sessions tws
    JOIN cu ON cu.user_id = tws.user_id
    WHERE tws.status = 'active'
    GROUP BY cu.company_id
  )
  SELECT
    c.id,
    c.name,
    c.created_at,
    COUNT(DISTINCT cu.user_id)   AS user_count,
    COALESCE(tc.cnt, 0)          AS task_count,
    COALESCE(sw.mins, 0)         AS session_minutes_week,
    COALESCE(sn.cnt, 0)          AS active_sessions_now,
    sw.last_at                   AS last_active_at
  FROM public.companies c
  LEFT JOIN cu             ON cu.company_id = c.id
  LEFT JOIN task_counts tc ON tc.company_id = c.id
  LEFT JOIN sessions_week sw ON sw.company_id = c.id
  LEFT JOIN sessions_now  sn ON sn.company_id = c.id
  GROUP BY c.id, c.name, c.created_at, tc.cnt, sw.mins, sw.last_at, sn.cnt
  ORDER BY COALESCE(sw.mins, 0) DESC NULLS LAST;
END;
$$;

-- ── 2. rpc_platform_activity_timeline ───────────────────────────────
-- Returns day-by-day task creation, session minutes, and active users
-- across the entire platform.
DROP FUNCTION IF EXISTS public.rpc_platform_activity_timeline(INT);
CREATE OR REPLACE FUNCTION public.rpc_platform_activity_timeline(p_days INT DEFAULT 30)
RETURNS TABLE (
  day             DATE,
  tasks_created   BIGINT,
  session_minutes BIGINT,
  active_users    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email NOT IN ('adamsamir2005@gmail.com', 'adam.samir@trustedgellc.com', 'adamsamir@hotmail.com') THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH day_series AS (
    SELECT generate_series(
      (NOW() - (p_days * INTERVAL '1 day'))::DATE,
      NOW()::DATE,
      '1 day'::INTERVAL
    )::DATE AS day
  ),
  daily_tasks AS (
    SELECT t.created_at::DATE AS day, COUNT(*) AS cnt
    FROM public.tasks t
    WHERE t.created_at >= NOW() - (p_days * INTERVAL '1 day')
    GROUP BY t.created_at::DATE
  ),
  daily_sessions AS (
    SELECT
      tws.started_at::DATE AS day,
      COALESCE(SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::BIGINT, 0) AS mins,
      COUNT(DISTINCT tws.user_id) AS users
    FROM public.task_work_sessions tws
    WHERE tws.started_at >= NOW() - (p_days * INTERVAL '1 day')
    GROUP BY tws.started_at::DATE
  )
  SELECT
    ds.day,
    COALESCE(dt.cnt, 0)    AS tasks_created,
    COALESCE(dws.mins, 0)  AS session_minutes,
    COALESCE(dws.users, 0) AS active_users
  FROM day_series ds
  LEFT JOIN daily_tasks    dt  ON dt.day  = ds.day
  LEFT JOIN daily_sessions dws ON dws.day = ds.day
  ORDER BY ds.day ASC;
END;
$$;

-- ── 3. rpc_platform_live_sessions ───────────────────────────────────
-- Returns all currently active work sessions across all tenants.
DROP FUNCTION IF EXISTS public.rpc_platform_live_sessions();
CREATE OR REPLACE FUNCTION public.rpc_platform_live_sessions()
RETURNS TABLE (
  session_id        UUID,
  user_id           UUID,
  user_name         TEXT,
  user_email        TEXT,
  company_id        UUID,
  company_name      TEXT,
  task_id           UUID,
  task_title        TEXT,
  started_at        TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  duration_minutes  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email NOT IN ('adamsamir2005@gmail.com', 'adam.samir@trustedgellc.com', 'adamsamir@hotmail.com') THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    tws.id                                                    AS session_id,
    tws.user_id,
    COALESCE(u.display_name, u.full_name, au.email)           AS user_name,
    au.email                                                  AS user_email,
    u.company_id,
    c.name                                                    AS company_name,
    tws.task_id,
    t.title                                                   AS task_title,
    tws.started_at,
    tws.last_heartbeat_at,
    GREATEST(0, EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at))::INT / 60) AS duration_minutes
  FROM public.task_work_sessions tws
  JOIN  auth.users au  ON au.id  = tws.user_id
  LEFT JOIN public.users u   ON u.id   = tws.user_id
  LEFT JOIN public.companies c ON c.id  = u.company_id
  LEFT JOIN public.tasks t    ON t.id   = tws.task_id
  WHERE tws.status = 'active'
  ORDER BY tws.started_at DESC;
END;
$$;

-- ── 4. rpc_platform_company_detail ──────────────────────────────────
-- Returns a single JSON object with full detail on one tenant company.
DROP FUNCTION IF EXISTS public.rpc_platform_company_detail(UUID);
CREATE OR REPLACE FUNCTION public.rpc_platform_company_detail(p_company_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT;
  v_result JSON;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email NOT IN ('adamsamir2005@gmail.com', 'adam.samir@trustedgellc.com', 'adamsamir@hotmail.com') THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'company', row_to_json(c.*),
    'members', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id',                   u.id,
          'name',                 COALESCE(u.display_name, u.full_name, au.email),
          'email',                au.email,
          'job_title',            u.job_title,
          'department',           u.department,
          'session_minutes_week', COALESCE((
            SELECT SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::INT
            FROM public.task_work_sessions tws
            WHERE tws.user_id = u.id
              AND tws.started_at >= NOW() - INTERVAL '7 days'
          ), 0),
          'is_active', EXISTS(
            SELECT 1 FROM public.task_work_sessions tws2
            WHERE tws2.user_id = u.id AND tws2.status = 'active'
          )
        ) ORDER BY COALESCE(u.full_name, au.email)
      )
      FROM public.users u
      JOIN auth.users au ON au.id = u.id
      WHERE u.company_id = p_company_id
    ), '[]'::JSON),
    'stats', json_build_object(
      'total_tasks', (
        SELECT COUNT(*)
        FROM public.tasks t
        JOIN public.users u ON u.id = t.manager_id
        WHERE u.company_id = p_company_id
      ),
      'total_session_minutes', COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::INT
        FROM public.task_work_sessions tws
        JOIN public.users u ON u.id = tws.user_id
        WHERE u.company_id = p_company_id
      ), 0),
      'active_sessions', (
        SELECT COUNT(*)
        FROM public.task_work_sessions tws
        JOIN public.users u ON u.id = tws.user_id
        WHERE u.company_id = p_company_id AND tws.status = 'active'
      )
    )
  ) INTO v_result
  FROM public.companies c
  WHERE c.id = p_company_id;

  RETURN v_result;
END;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rpc_platform_companies_overview()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_activity_timeline(INT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_live_sessions()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_company_detail(UUID)       TO authenticated;
