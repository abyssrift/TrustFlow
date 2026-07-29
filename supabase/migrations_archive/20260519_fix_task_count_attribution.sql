-- Fix: task_count on the tenants overview was attributed to the manager's
-- *current* company (via JOIN on users.company_id), so moving a user between
-- companies shifted all their historical tasks to the new company.
-- Tasks have their own company_id stamped at creation — use that instead.

DROP FUNCTION IF EXISTS public.rpc_platform_companies_overview(BOOLEAN);
CREATE FUNCTION public.rpc_platform_companies_overview(_dummy BOOLEAN DEFAULT NULL)
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
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = auth.uid();
  IF v_email IS NULL OR v_email NOT IN (
    'adamsamir2005@gmail.com','adam.samir@trustedgellc.com','adamsamir@hotmail.com'
  ) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cu AS (
    SELECT u.company_id, u.id AS user_id
    FROM public.users u
    WHERE u.company_id IS NOT NULL
  ),
  task_counts AS (
    -- Count tasks by tasks.company_id (immutable, set at creation time).
    -- Previously joined through users.company_id which moves when a user
    -- is transferred, causing tasks to follow the user to their new company.
    SELECT t.company_id, COUNT(DISTINCT t.id) AS cnt
    FROM public.tasks t
    WHERE t.company_id IS NOT NULL
    GROUP BY t.company_id
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

REVOKE EXECUTE ON FUNCTION public.rpc_platform_companies_overview(BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_platform_companies_overview(BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.rpc_platform_companies_overview(BOOLEAN) TO authenticated;
