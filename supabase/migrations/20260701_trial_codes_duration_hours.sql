-- Switch trial_codes from coarse `months` to `duration_hours` so admins can
-- issue 1-hour, 1-day, or multi-month trial codes.

ALTER TABLE public.trial_codes RENAME COLUMN months TO duration_hours;
ALTER TABLE public.trial_codes DROP CONSTRAINT IF EXISTS trial_codes_months_check;
-- max 2 years = 17 520 hours
ALTER TABLE public.trial_codes ADD CONSTRAINT trial_codes_duration_hours_check
  CHECK (duration_hours >= 1 AND duration_hours <= 17520);

-- ── rpc_redeem_trial_code ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_redeem_trial_code(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company     uuid := public.my_company_id();
  v_user_id     uuid := auth.uid();
  v_code_row    public.trial_codes%rowtype;
  v_trial_ends  timestamptz;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT public._can_manage_billing() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_code_row FROM public.trial_codes WHERE upper(code) = upper(p_code);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid trial code.';
  END IF;
  IF v_code_row.expires_at IS NOT NULL AND v_code_row.expires_at < now() THEN
    RAISE EXCEPTION 'This trial code has expired.';
  END IF;
  IF v_code_row.max_redemptions IS NOT NULL AND v_code_row.redeemed_count >= v_code_row.max_redemptions THEN
    RAISE EXCEPTION 'This trial code has been fully redeemed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.trial_code_redemptions
    WHERE code_id = v_code_row.id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Your workspace has already redeemed this code.';
  END IF;

  v_trial_ends := now() + (v_code_row.duration_hours || ' hours')::interval;

  INSERT INTO public.company_billing (company_id, plan_code, status, trial_ends_at, updated_at)
  VALUES (v_company, v_code_row.plan_code, 'trialing', v_trial_ends, now())
  ON CONFLICT (company_id) DO UPDATE
    SET plan_code     = v_code_row.plan_code,
        status        = 'trialing',
        trial_ends_at = v_trial_ends,
        updated_at    = now();

  INSERT INTO public.trial_code_redemptions (code_id, company_id, redeemed_at, trial_ends_at)
  VALUES (v_code_row.id, v_company, now(), v_trial_ends);

  UPDATE public.trial_codes SET redeemed_count = redeemed_count + 1 WHERE id = v_code_row.id;

  INSERT INTO public.billing_events (company_id, type, plan_code, created_by, data)
  VALUES (v_company, 'trial_started', v_code_row.plan_code, v_user_id,
    jsonb_build_object('code', v_code_row.code, 'duration_hours', v_code_row.duration_hours, 'trial_ends_at', v_trial_ends));

  RETURN jsonb_build_object(
    'success',        true,
    'plan_code',      v_code_row.plan_code,
    'trial_ends_at',  v_trial_ends,
    'duration_hours', v_code_row.duration_hours
  );
END;
$$;

-- ── rpc_generate_trial_code ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_generate_trial_code(
  p_plan_code       text,
  p_duration_hours  int,
  p_max_redemptions int         DEFAULT 1,
  p_expires_at      timestamptz DEFAULT NULL,
  p_notes           text        DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code    text;
  v_id      uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND system_role = 'admin') THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE code = p_plan_code AND is_active = true) THEN
    RAISE EXCEPTION 'Unknown plan: %', p_plan_code;
  END IF;
  IF p_duration_hours < 1 OR p_duration_hours > 17520 THEN
    RAISE EXCEPTION 'Duration must be between 1 and 17520 hours.';
  END IF;

  -- Format: TF-PRO-24H-X7K2
  v_code := upper(format('TF-%s-%sH-%s',
    p_plan_code,
    p_duration_hours,
    left(replace(gen_random_uuid()::text, '-', ''), 4)
  ));

  INSERT INTO public.trial_codes (code, plan_code, duration_hours, max_redemptions, expires_at, created_by, notes)
  VALUES (v_code, p_plan_code, p_duration_hours, p_max_redemptions, p_expires_at, v_user_id, p_notes)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('code', v_code, 'id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_generate_trial_code(text, int, int, timestamptz, text) TO authenticated;

-- ── rpc_list_trial_codes ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_trial_codes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND system_role = 'admin') THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',              tc.id,
      'code',            tc.code,
      'plan_code',       tc.plan_code,
      'duration_hours',  tc.duration_hours,
      'max_redemptions', tc.max_redemptions,
      'redeemed_count',  tc.redeemed_count,
      'expires_at',      tc.expires_at,
      'notes',           tc.notes,
      'created_at',      tc.created_at
    ) ORDER BY tc.created_at DESC)
    FROM public.trial_codes tc
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_list_trial_codes() TO authenticated;
