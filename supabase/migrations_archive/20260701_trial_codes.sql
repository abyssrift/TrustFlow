-- Free trial codes: admin-generated codes that activate a timed trial on any plan.

-- ─────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trial_codes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text        UNIQUE NOT NULL,
  plan_code        text        NOT NULL REFERENCES public.billing_plans(code),
  months           int         NOT NULL CHECK (months BETWEEN 1 AND 24),
  max_redemptions  int,                        -- NULL = unlimited
  redeemed_count   int         NOT NULL DEFAULT 0,
  expires_at       timestamptz,                -- when the code itself expires (not the trial)
  created_by       uuid        REFERENCES auth.users,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trial_code_redemptions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id       uuid        NOT NULL REFERENCES public.trial_codes ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies ON DELETE CASCADE,
  redeemed_at   timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL,
  UNIQUE (code_id, company_id)   -- one redemption per company per code
);

ALTER TABLE public.trial_codes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_code_redemptions  ENABLE ROW LEVEL SECURITY;
-- All access goes through SECURITY DEFINER RPCs; no direct-access policies needed.

-- ─────────────────────────────────────────────────────────────
-- 2. rpc_redeem_trial_code — any billing manager
-- ─────────────────────────────────────────────────────────────
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

  v_trial_ends := now() + (v_code_row.months || ' months')::interval;

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
    jsonb_build_object('code', v_code_row.code, 'months', v_code_row.months, 'trial_ends_at', v_trial_ends));

  RETURN jsonb_build_object(
    'success',       true,
    'plan_code',     v_code_row.plan_code,
    'trial_ends_at', v_trial_ends,
    'months',        v_code_row.months
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_redeem_trial_code(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. rpc_generate_trial_code — platform admin only
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_generate_trial_code(
  p_plan_code       text,
  p_months          int,
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
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND (auth.jwt() ->> 'email') = ANY(ARRAY['adamsamir2005@gmail.com','adam.samir@trustedgellc.com','adamsamir@hotmail.com'])) THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE code = p_plan_code AND is_active = true) THEN
    RAISE EXCEPTION 'Unknown plan: %', p_plan_code;
  END IF;
  IF p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Months must be between 1 and 24.';
  END IF;

  -- Format: TF-PRO-3M-X7K2
  v_code := upper(format('TF-%s-%sM-%s',
    p_plan_code,
    p_months,
    left(replace(gen_random_uuid()::text, '-', ''), 4)
  ));

  INSERT INTO public.trial_codes (code, plan_code, months, max_redemptions, expires_at, created_by, notes)
  VALUES (v_code, p_plan_code, p_months, p_max_redemptions, p_expires_at, v_user_id, p_notes)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('code', v_code, 'id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_generate_trial_code(text, int, int, timestamptz, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. rpc_list_trial_codes — platform admin only
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_trial_codes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND (auth.jwt() ->> 'email') = ANY(ARRAY['adamsamir2005@gmail.com','adam.samir@trustedgellc.com','adamsamir@hotmail.com'])) THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',              tc.id,
      'code',            tc.code,
      'plan_code',       tc.plan_code,
      'months',          tc.months,
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

-- ─────────────────────────────────────────────────────────────
-- 5. rpc_revoke_trial_code — platform admin only
--    Soft-revoke: sets expires_at = now(). Existing trials are unaffected.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_revoke_trial_code(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND (auth.jwt() ->> 'email') = ANY(ARRAY['adamsamir2005@gmail.com','adam.samir@trustedgellc.com','adamsamir@hotmail.com'])) THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  UPDATE public.trial_codes SET expires_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trial code not found.'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_trial_code(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. Daily expiry: downgrade trialing companies whose trial ended
-- ─────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'trial-expiry-check',
  '0 6 * * *',
  $$
    UPDATE public.company_billing
    SET plan_code     = 'free',
        status        = 'active',
        trial_ends_at = NULL,
        updated_at    = now()
    WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < now()
  $$
);
