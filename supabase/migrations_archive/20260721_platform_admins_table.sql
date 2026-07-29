-- Platform admin access control, take 2.
--
-- Problems fixed:
-- 1. "Who is a platform admin" was a hardcoded 3-email array, copy-pasted across
--    ~7 migrations and a client-side constant. Adding a developer meant editing
--    SQL in multiple places. Now it's rows in public.platform_admins.
-- 2. Several rpc_platform_* functions (delete_user, move_user, update_user,
--    search_users, infra_metrics) had NO admin check at all and were GRANTed to
--    `anon` — callable by anyone with the public anon key, no login required.
-- 3. rpc_platform_company_retention / rpc_platform_extend_retention had a check
--    written as `IF v_email NOT IN (...)`. For an anonymous caller v_email is
--    NULL, `NULL NOT IN (...)` evaluates to NULL, and `IF NULL` is falsy in
--    plpgsql — the RAISE EXCEPTION never fires and the function runs anyway.
--    Switching to an EXISTS-based check makes this class of bug structurally
--    impossible (EXISTS is always true/false, never NULL).

-- ─────────────────────────────────────────────────────────────
-- 1. platform_admins table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_admins (
  email      text        PRIMARY KEY,
  added_by   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies: direct PostgREST access is blocked. All reads/writes go through
-- the SECURITY DEFINER RPCs below, which bypass RLS as the function owner.

INSERT INTO public.platform_admins (email, added_by) VALUES
  ('adamsamir2005@gmail.com',    'migration'),
  ('adam.samir@trustedgellc.com','migration'),
  ('adamsamir@hotmail.com',      'migration')
ON CONFLICT (email) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. Central helper — every platform RPC below calls this instead of
--    inlining an email check.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE email = (auth.jwt() ->> 'email')
  )
$$;

-- Client-callable check (used to gate the admin panel's UI, not security itself —
-- the RPCs below are the actual boundary).
CREATE OR REPLACE FUNCTION public.rpc_am_i_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._is_platform_admin()
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. Self-service admin management (platform admins only)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_admins_list()
RETURNS TABLE (email text, added_by text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  RETURN QUERY
  SELECT pa.email, pa.added_by, pa.created_at
  FROM public.platform_admins pa
  ORDER BY pa.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_admin_add(p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Email is required.';
  END IF;
  INSERT INTO public.platform_admins (email, added_by)
  VALUES (lower(trim(p_email)), auth.jwt() ->> 'email')
  ON CONFLICT (email) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_admin_remove(p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF (SELECT COUNT(*) FROM public.platform_admins) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last platform admin.';
  END IF;
  DELETE FROM public.platform_admins WHERE email = lower(trim(p_email));
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Existing platform RPCs — swap inline email arrays for the helper
--    (bodies unchanged otherwise; this also fixes the NULL-bypass in the
--    two retention functions).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_companies_overview(_dummy BOOLEAN DEFAULT NULL)
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cu AS (
    SELECT u.company_id, u.id AS user_id
    FROM public.users u
    WHERE u.company_id IS NOT NULL
  ),
  task_counts AS (
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

CREATE OR REPLACE FUNCTION public.rpc_platform_activity_timeline(p_days INT DEFAULT 30)
RETURNS TABLE (
  day             DATE,
  tasks_created   BIGINT,
  session_minutes BIGINT,
  active_users    BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
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

CREATE OR REPLACE FUNCTION public.rpc_platform_live_sessions(_dummy BOOLEAN DEFAULT NULL)
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
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

CREATE OR REPLACE FUNCTION public.rpc_platform_company_detail(p_company_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSON;
BEGIN
  IF NOT public._is_platform_admin() THEN
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
        SELECT COUNT(*) FROM public.tasks t
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
        SELECT COUNT(*) FROM public.task_work_sessions tws
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

CREATE OR REPLACE FUNCTION public.rpc_platform_delete_company(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users  SET reports_to     = NULL WHERE company_id = p_company_id;
  UPDATE public.teams  SET manager_id     = NULL WHERE company_id = p_company_id;
  UPDATE public.teams  SET parent_team_id = NULL WHERE company_id = p_company_id;

  DELETE FROM public.task_manual_time_entries WHERE company_id = p_company_id;
  DELETE FROM public.user_roles               WHERE company_id = p_company_id;
  DELETE FROM public.team_roles               WHERE company_id = p_company_id;
  DELETE FROM public.team_members             WHERE company_id = p_company_id;
  DELETE FROM public.task_comments            WHERE company_id = p_company_id;
  DELETE FROM public.task_work_sessions       WHERE company_id = p_company_id;
  DELETE FROM public.pipeline_stage_targets   WHERE company_id = p_company_id;
  DELETE FROM public.storage_archive_queue    WHERE company_id = p_company_id;
  DELETE FROM public.archives                 WHERE company_id = p_company_id;

  DELETE FROM public.companies WHERE id = p_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_company_retention(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settings        public.company_retention_settings%ROWTYPE;
  v_last_active     TIMESTAMPTZ;
  v_days_inactive   INT;
  v_file_count      BIGINT;
  v_session_minutes BIGINT;
  v_file_size_bytes BIGINT;
  v_db_size_bytes   BIGINT;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings
  FROM public.company_retention_settings
  WHERE company_id = p_company_id;

  IF NOT FOUND THEN
    v_settings.company_id            := p_company_id;
    v_settings.inactivity_days       := 90;
    v_settings.warning_interval_days := 10;
    v_settings.user_inactivity_days  := 90;
    v_settings.warnings_enabled      := true;
  END IF;

  SELECT GREATEST(
    COALESCE(MAX(u.last_seen_at), 'epoch'::TIMESTAMPTZ),
    (SELECT created_at FROM public.companies WHERE id = p_company_id)
  ) INTO v_last_active
  FROM public.users u
  WHERE u.company_id = p_company_id AND u.deleted_at IS NULL;

  v_days_inactive := FLOOR(EXTRACT(EPOCH FROM (now() - v_last_active)) / 86400)::INT;

  SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
  INTO v_file_count, v_file_size_bytes
  FROM public.filehub_files
  WHERE company_id = p_company_id AND deleted_at IS NULL;

  SELECT COALESCE(
    SUM(FLOOR(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)) / 60)),
    0
  ) INTO v_session_minutes
  FROM public.task_work_sessions
  WHERE company_id = p_company_id AND status = 'completed';

  SELECT (
    (SELECT COALESCE(SUM(pg_column_size(t.*)), 0) FROM public.tasks t WHERE t.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(s.*)), 0) FROM public.task_work_sessions s WHERE s.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(c.*)), 0) FROM public.task_comments c WHERE c.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(f.*)), 0) FROM public.filehub_files f WHERE f.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(u.*)), 0) FROM public.users u WHERE u.company_id = p_company_id AND u.deleted_at IS NULL)
  ) INTO v_db_size_bytes;

  RETURN jsonb_build_object(
    'days_inactive',         v_days_inactive,
    'days_until_purge',      GREATEST(v_settings.inactivity_days - v_days_inactive, 0),
    'inactivity_days',       v_settings.inactivity_days,
    'warning_interval_days', v_settings.warning_interval_days,
    'last_active_at',        v_last_active,
    'status', CASE
      WHEN v_days_inactive >= v_settings.inactivity_days THEN 'overdue'
      WHEN v_days_inactive >= v_settings.inactivity_days - v_settings.warning_interval_days THEN 'warning'
      ELSE 'active'
    END,
    'file_count',      v_file_count,
    'session_minutes', v_session_minutes,
    'file_size_bytes', v_file_size_bytes,
    'db_size_bytes',   v_db_size_bytes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_extend_retention(
  p_company_id      UUID,
  p_inactivity_days INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  p_inactivity_days := LEAST(GREATEST(p_inactivity_days, 7), 3650);

  INSERT INTO public.company_retention_settings AS s
    (company_id, inactivity_days, warning_interval_days, user_inactivity_days, warnings_enabled, updated_by, updated_at)
  VALUES
    (p_company_id, p_inactivity_days, 10, 90, true, auth.uid(), now())
  ON CONFLICT (company_id) DO UPDATE SET
    inactivity_days = EXCLUDED.inactivity_days,
    updated_by      = EXCLUDED.updated_by,
    updated_at      = now();
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. Previously-unchecked RPCs — add the admin gate.
--    rpc_platform_search_users converts from LANGUAGE sql to plpgsql so it
--    can carry the guard.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_delete_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'auth' AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  UPDATE users             SET reports_to  = NULL WHERE reports_to  = p_user_id;
  UPDATE teams             SET manager_id  = NULL WHERE manager_id  = p_user_id;
  UPDATE archives          SET archived_by = NULL WHERE archived_by = p_user_id;
  UPDATE archives          SET restored_by = NULL WHERE restored_by = p_user_id;

  DELETE FROM task_comments      WHERE author_id = p_user_id;
  DELETE FROM task_work_sessions WHERE user_id   = p_user_id;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_move_user(p_user_id uuid, p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  UPDATE users SET
    company_id = p_company_id,
    is_owner   = false,
    updated_at = now()
  WHERE id = p_user_id AND deleted_at IS NULL;

  DELETE FROM user_roles WHERE user_id = p_user_id;
  DELETE FROM team_members WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_update_user(
  p_user_id uuid, p_full_name text, p_display_name text, p_phone text,
  p_job_title text, p_department text, p_work_status text, p_is_active boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  UPDATE users SET
    full_name    = NULLIF(TRIM(COALESCE(p_full_name,    '')), ''),
    display_name = NULLIF(TRIM(COALESCE(p_display_name, '')), ''),
    phone        = NULLIF(TRIM(COALESCE(p_phone,        '')), ''),
    job_title    = NULLIF(TRIM(COALESCE(p_job_title,    '')), ''),
    department   = NULLIF(TRIM(COALESCE(p_department,   '')), ''),
    work_status  = NULLIF(TRIM(COALESCE(p_work_status,  '')), ''),
    is_active    = p_is_active,
    updated_at   = now()
  WHERE id = p_user_id AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_search_users(
  p_query text DEFAULT '', p_company_id uuid DEFAULT NULL, p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid, email text, full_name text, display_name text, avatar_url text,
  phone text, job_title text, department text, is_active boolean, is_owner boolean,
  work_status text, company_id uuid, company_name text, created_at timestamptz, last_seen_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    u.id, u.email, u.full_name, u.display_name, u.avatar_url, u.phone,
    u.job_title, u.department, u.is_active, u.is_owner, u.work_status,
    u.company_id, c.name AS company_name, u.created_at, u.last_seen_at
  FROM users u
  LEFT JOIN companies c ON c.id = u.company_id
  WHERE u.deleted_at IS NULL
    AND (
      p_query = ''
      OR u.email        ILIKE '%' || p_query || '%'
      OR u.full_name    ILIKE '%' || p_query || '%'
      OR u.display_name ILIKE '%' || p_query || '%'
    )
    AND (p_company_id IS NULL OR u.company_id = p_company_id)
  ORDER BY u.created_at DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_infra_metrics(p_limit integer DEFAULT 96)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_db_size          bigint;
  v_active_conn      int;
  v_max_conn         int;
  v_cache_hit        numeric;
  v_total_tables     int;
  v_xact_total       bigint;
  v_prev_xact_total  bigint;
  v_prev_at          timestamptz;
  v_tps              numeric := 0;
  v_secs             numeric;
  v_table_sizes      jsonb;
  v_snapshots        jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  SELECT pg_database_size(current_database()) INTO v_db_size;

  SELECT count(*)::int INTO v_active_conn
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state IS NOT NULL
    AND pid != pg_backend_pid();

  SELECT setting::int INTO v_max_conn
  FROM pg_settings WHERE name = 'max_connections';

  SELECT
    CASE WHEN (blks_hit + blks_read) > 0
      THEN round((blks_hit::numeric / (blks_hit + blks_read)) * 100, 2)
      ELSE 100.00
    END
  INTO v_cache_hit
  FROM pg_stat_database
  WHERE datname = current_database();

  SELECT count(*)::int INTO v_total_tables
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

  SELECT (xact_commit + xact_rollback)::bigint INTO v_xact_total
  FROM pg_stat_database
  WHERE datname = current_database();

  SELECT xact_total, captured_at
  INTO v_prev_xact_total, v_prev_at
  FROM platform_infra_snapshots
  ORDER BY captured_at DESC
  LIMIT 1;

  IF v_prev_xact_total IS NOT NULL AND v_prev_at IS NOT NULL
     AND v_xact_total > v_prev_xact_total
  THEN
    v_secs := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_prev_at)));
    v_tps  := round((v_xact_total - v_prev_xact_total)::numeric / v_secs, 2);
  END IF;

  INSERT INTO platform_infra_snapshots
    (db_size_bytes, active_connections, max_connections, cache_hit_ratio, xact_total)
  SELECT v_db_size, v_active_conn, v_max_conn, v_cache_hit, v_xact_total
  WHERE NOT EXISTS (
    SELECT 1 FROM platform_infra_snapshots
    WHERE captured_at > now() - interval '5 minutes'
  );

  DELETE FROM platform_infra_snapshots
  WHERE captured_at < now() - interval '7 days';

  SELECT jsonb_agg(t)
  INTO v_table_sizes
  FROM (
    SELECT jsonb_build_object(
      'name',        relname,
      'size_bytes',  pg_total_relation_size(relid),
      'size_pretty', pg_size_pretty(pg_total_relation_size(relid))
    ) AS t
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 12
  ) sub;

  SELECT jsonb_agg(
    jsonb_build_object(
      'captured_at',        captured_at,
      'db_size_bytes',      db_size_bytes,
      'active_connections', active_connections,
      'cache_hit_ratio',    cache_hit_ratio
    )
    ORDER BY captured_at ASC
  )
  INTO v_snapshots
  FROM (
    SELECT * FROM platform_infra_snapshots
    ORDER BY captured_at DESC
    LIMIT p_limit
  ) s;

  RETURN jsonb_build_object(
    'current', jsonb_build_object(
      'db_size_bytes',      v_db_size,
      'db_size_pretty',     pg_size_pretty(v_db_size),
      'active_connections', v_active_conn,
      'max_connections',    v_max_conn,
      'connection_pct',     CASE WHEN v_max_conn > 0
                              THEN round((v_active_conn::numeric / v_max_conn) * 100, 1)
                              ELSE 0 END,
      'cache_hit_ratio',    v_cache_hit,
      'total_tables',       v_total_tables,
      'tps',                GREATEST(0, v_tps)
    ),
    'snapshots',   COALESCE(v_snapshots,   '[]'::jsonb),
    'table_sizes', COALESCE(v_table_sizes, '[]'::jsonb)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. Lock down grants: authenticated only, everywhere. This is the line that
--    actually closes the anon exposure (the checks above are defense in depth).
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname ILIKE 'rpc_platform%' OR p.proname = 'rpc_am_i_platform_admin')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._is_platform_admin() FROM PUBLIC, anon, authenticated;
