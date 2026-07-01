-- Billing plan limits: seat caps, feature flags, DB enforcement.
-- No payment gateway required — limits are enforced at the DB layer.

-- ─────────────────────────────────────────────────────────────
-- Add limits column to billing_plans
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}';

-- max_members: int = hard cap, null = unlimited
-- features: string[] = feature keys gated to this plan and above
UPDATE public.billing_plans SET limits = '{"max_members": 5,    "features": []}'::jsonb WHERE code = 'free';
UPDATE public.billing_plans SET limits = '{"max_members": null, "features": ["filehub","analytics","reporting"]}'::jsonb WHERE code = 'pro';
UPDATE public.billing_plans SET limits = '{"max_members": null, "features": ["filehub","analytics","reporting","retention","automations","data_export"]}'::jsonb WHERE code = 'business';
UPDATE public.billing_plans SET limits = '{"max_members": null, "features": ["filehub","analytics","reporting","retention","automations","data_export","sso"]}'::jsonb WHERE code = 'enterprise';

-- ─────────────────────────────────────────────────────────────
-- Internal helper: member limit for a company (-1 = unlimited)
-- Falls back to 5 (free plan) if no billing row exists.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._company_member_limit(p_company_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN (bp.limits->>'max_members') IS NULL THEN -1
        ELSE (bp.limits->>'max_members')::int
      END
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = p_company_id
    ),
    5  -- default: free plan cap, if no billing row
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- Frontend RPC: check a named limit for the caller's company
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_check_plan_limit(p_resource text DEFAULT 'members')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := public.my_company_id();
  v_current int;
  v_limit   int;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;

  IF p_resource = 'members' THEN
    SELECT COUNT(*) INTO v_current
    FROM public.users
    WHERE company_id = v_company AND deleted_at IS NULL;

    v_limit := public._company_member_limit(v_company);

    RETURN jsonb_build_object(
      'resource', 'members',
      'current',  v_current,
      'limit',    CASE WHEN v_limit = -1 THEN NULL ELSE v_limit END,
      'allowed',  v_limit = -1 OR v_current < v_limit
    );
  END IF;

  RAISE EXCEPTION 'Unknown resource: %', p_resource;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_check_plan_limit(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- DB enforcement: block joining a company that's at its member cap.
-- Fires on UPDATE when company_id changes (null → some_id).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._enforce_member_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit   int;
  v_current int;
BEGIN
  -- only act when user is joining a company (company_id being set for first time)
  IF NEW.company_id IS NULL OR OLD.company_id = NEW.company_id THEN
    RETURN NEW;
  END IF;

  v_limit := public._company_member_limit(NEW.company_id);
  IF v_limit = -1 THEN RETURN NEW; END IF;  -- unlimited plan

  SELECT COUNT(*) INTO v_current
  FROM public.users
  WHERE company_id = NEW.company_id AND deleted_at IS NULL AND id != NEW.id;

  IF v_current >= v_limit THEN
    RAISE EXCEPTION 'Member limit reached (% of % seats). Upgrade your plan to add more members.',
      v_current, v_limit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_member_limit ON public.users;
CREATE TRIGGER enforce_member_limit
  BEFORE UPDATE OF company_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public._enforce_member_limit();

-- ─────────────────────────────────────────────────────────────
-- Update rpc_billing_overview to expose member_limit + plan limits
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_billing_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company      uuid := public.my_company_id();
  v_billing      public.company_billing%rowtype;
  v_seats        int;
  v_limits       jsonb;
  v_member_limit int;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT public._can_manage_billing() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_billing FROM public.company_billing WHERE company_id = v_company;
  IF NOT FOUND THEN
    v_billing.company_id := v_company;
    v_billing.plan_code  := 'free';
    v_billing.status     := 'active';
    v_billing.seats      := 1;
  END IF;

  SELECT COUNT(*) INTO v_seats FROM public.users WHERE company_id = v_company AND deleted_at IS NULL;

  SELECT COALESCE(bp.limits, '{}') INTO v_limits
  FROM public.billing_plans bp WHERE bp.code = v_billing.plan_code;

  v_member_limit := public._company_member_limit(v_company);

  RETURN jsonb_build_object(
    'billing', jsonb_build_object(
      'plan_code',         v_billing.plan_code,
      'status',            v_billing.status,
      'seats',             v_billing.seats,
      'active_members',    v_seats,
      'member_limit',      CASE WHEN v_member_limit = -1 THEN NULL ELSE v_member_limit END,
      'external_provider', v_billing.external_provider,
      'current_period_end',v_billing.current_period_end,
      'trial_ends_at',     v_billing.trial_ends_at,
      'connected',         v_billing.external_subscription_id IS NOT NULL
    ),
    'limits', v_limits,
    'plans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'code',        p.code,
               'name',        p.name,
               'description', p.description,
               'price_cents', p.price_cents,
               'currency',    p.currency,
               'interval',    p.interval,
               'per_seat',    p.per_seat,
               'features',    p.features,
               'limits',      p.limits
             ) ORDER BY p.sort_order)
      FROM public.billing_plans p WHERE p.is_active = true
    ), '[]'::jsonb)
  );
END;
$$;
