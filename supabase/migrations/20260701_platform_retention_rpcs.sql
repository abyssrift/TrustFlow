-- Platform admin: per-tenant retention overview and threshold management.
-- These bypass my_company_id() and check the caller is a platform owner by email.

-- ── 1. Read retention status for any company ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_company_retention(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email           TEXT;
  v_settings        public.company_retention_settings%ROWTYPE;
  v_last_active     TIMESTAMPTZ;
  v_days_inactive   INT;
  v_file_count      BIGINT;
  v_session_minutes BIGINT;
BEGIN
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = auth.uid();
  IF v_email NOT IN (
    'adamsamir2005@gmail.com','adam.samir@trustedgellc.com','adamsamir@hotmail.com'
  ) THEN
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

  SELECT COUNT(*) INTO v_file_count
  FROM public.filehub_files
  WHERE company_id = p_company_id AND deleted_at IS NULL;

  SELECT COALESCE(
    SUM(FLOOR(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)) / 60)),
    0
  ) INTO v_session_minutes
  FROM public.task_work_sessions
  WHERE company_id = p_company_id AND status = 'completed';

  RETURN jsonb_build_object(
    'days_inactive',         v_days_inactive,
    'days_until_purge',      GREATEST(v_settings.inactivity_days - v_days_inactive, 0),
    'inactivity_days',       v_settings.inactivity_days,
    'warning_interval_days', v_settings.warning_interval_days,
    'last_active_at',        v_last_active,
    'status', CASE
      WHEN v_days_inactive >= v_settings.inactivity_days
        THEN 'overdue'
      WHEN v_days_inactive >= v_settings.inactivity_days - v_settings.warning_interval_days
        THEN 'warning'
      ELSE 'active'
    END,
    'file_count',            v_file_count,
    'session_minutes',       v_session_minutes
  );
END;
$$;

-- ── 2. Extend (or cancel) retention threshold for any company ───────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_extend_retention(
  p_company_id      UUID,
  p_inactivity_days INT   -- pass 3650 to effectively cancel
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = auth.uid();
  IF v_email NOT IN (
    'adamsamir2005@gmail.com','adam.samir@trustedgellc.com','adamsamir@hotmail.com'
  ) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  -- Clamp to the table's constraint range
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

GRANT EXECUTE ON FUNCTION public.rpc_platform_company_retention(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_extend_retention(UUID, INT) TO authenticated;
