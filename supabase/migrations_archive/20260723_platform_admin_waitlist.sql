-- Surfaces the public waitlist (20260723_waitlist_signups.sql) inside the
-- platform-admin Control Plane: totals + referral leaderboard, a
-- signups-per-day timeline (same shape as rpc_platform_activity_timeline),
-- and a searchable list — mirroring the existing Tenants/Signals sections.

CREATE OR REPLACE FUNCTION public.rpc_platform_waitlist_overview()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total    bigint;
  v_today    bigint;
  v_week     bigint;
  v_referred bigint;
  v_top      jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.waitlist_signups;
  SELECT count(*) INTO v_today FROM public.waitlist_signups WHERE created_at >= date_trunc('day', now());
  SELECT count(*) INTO v_week FROM public.waitlist_signups WHERE created_at >= now() - interval '7 days';
  SELECT count(*) INTO v_referred FROM public.waitlist_signups WHERE referred_by_id IS NOT NULL;

  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_top
  FROM (
    SELECT
      r.company_name,
      r.referral_code,
      count(w.id) AS referred_count
    FROM public.waitlist_signups r
    JOIN public.waitlist_signups w ON w.referred_by_id = r.id
    GROUP BY r.id, r.company_name, r.referral_code
    ORDER BY count(w.id) DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'today', v_today,
    'this_week', v_week,
    'referred', v_referred,
    'top_referrers', v_top
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_waitlist_timeline(p_days INT DEFAULT 30)
RETURNS TABLE (day DATE, signups BIGINT)
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
  daily AS (
    SELECT w.created_at::DATE AS day, COUNT(*) AS cnt
    FROM public.waitlist_signups w
    WHERE w.created_at >= NOW() - (p_days * INTERVAL '1 day')
    GROUP BY w.created_at::DATE
  )
  SELECT ds.day, COALESCE(d.cnt, 0) AS signups
  FROM day_series ds
  LEFT JOIN daily d ON d.day = ds.day
  ORDER BY ds.day ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_platform_waitlist_list(p_query TEXT DEFAULT '', p_limit INT DEFAULT 100)
RETURNS TABLE (
  id                  uuid,
  email               text,
  company_name        text,
  referral_code       text,
  referred_by_company text,
  created_at          timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT w.id, w.email, w.company_name, w.referral_code, r.company_name, w.created_at
  FROM public.waitlist_signups w
  LEFT JOIN public.waitlist_signups r ON r.id = w.referred_by_id
  WHERE p_query = '' OR w.email ILIKE '%' || p_query || '%' OR w.company_name ILIKE '%' || p_query || '%'
  ORDER BY w.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_platform_waitlist_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_platform_waitlist_timeline(INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_platform_waitlist_list(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_platform_waitlist_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_waitlist_timeline(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_waitlist_list(TEXT, INT) TO authenticated;
