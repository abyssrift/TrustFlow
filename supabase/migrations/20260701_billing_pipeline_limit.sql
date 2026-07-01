-- Pipeline creation limits: Free tier capped at 3 pipelines.

-- ─────────────────────────────────────────────────────────────
-- 1. Add max_pipelines to billing_plans.limits
-- ─────────────────────────────────────────────────────────────
UPDATE public.billing_plans SET limits = limits || '{"max_pipelines": 3}'::jsonb    WHERE code = 'free';
UPDATE public.billing_plans SET limits = limits || '{"max_pipelines": null}'::jsonb  WHERE code = 'pro';
UPDATE public.billing_plans SET limits = limits || '{"max_pipelines": null}'::jsonb  WHERE code = 'business';
UPDATE public.billing_plans SET limits = limits || '{"max_pipelines": null}'::jsonb  WHERE code = 'enterprise';

-- ─────────────────────────────────────────────────────────────
-- 2. Helper: pipeline limit for a company (-1 = unlimited)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._company_pipeline_limit(p_company_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN (bp.limits->>'max_pipelines') IS NULL THEN -1
        ELSE (bp.limits->>'max_pipelines')::int
      END
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = p_company_id
    ),
    3  -- default: free plan cap
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. DB enforcement: block pipeline creation at cap
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._enforce_pipeline_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit   int;
  v_current int;
BEGIN
  v_limit := public._company_pipeline_limit(NEW.company_id);
  IF v_limit = -1 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.pipelines
  WHERE company_id = NEW.company_id AND deleted_at IS NULL;

  IF v_current >= v_limit THEN
    RAISE EXCEPTION 'Pipeline limit reached (% of % pipelines). Upgrade your plan to create more.',
      v_current, v_limit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_pipeline_limit ON public.pipelines;
CREATE TRIGGER enforce_pipeline_limit
  BEFORE INSERT ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public._enforce_pipeline_limit();

-- ─────────────────────────────────────────────────────────────
-- 4. Extend rpc_check_plan_limit to support 'pipelines' resource
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
    FROM public.users WHERE company_id = v_company AND deleted_at IS NULL;
    v_limit := public._company_member_limit(v_company);

  ELSIF p_resource = 'pipelines' THEN
    SELECT COUNT(*) INTO v_current
    FROM public.pipelines WHERE company_id = v_company AND deleted_at IS NULL;
    v_limit := public._company_pipeline_limit(v_company);

  ELSE
    RAISE EXCEPTION 'Unknown resource: %', p_resource;
  END IF;

  RETURN jsonb_build_object(
    'resource', p_resource,
    'current',  v_current,
    'limit',    CASE WHEN v_limit = -1 THEN NULL ELSE v_limit END,
    'allowed',  v_limit = -1 OR v_current < v_limit
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. rpc_billing_overview: add pipeline_count + pipeline_limit
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_billing_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company         uuid := public.my_company_id();
  v_billing         public.company_billing%rowtype;
  v_seats           int;
  v_pipeline_count  int;
  v_limits          jsonb;
  v_member_limit    int;
  v_pipeline_limit  int;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT public._can_manage_billing() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_billing FROM public.company_billing WHERE company_id = v_company;
  IF NOT FOUND THEN
    v_billing.company_id         := v_company;
    v_billing.plan_code          := 'free';
    v_billing.status             := 'active';
    v_billing.seats              := 1;
    v_billing.storage_used_bytes := 0;
  END IF;

  SELECT COUNT(*) INTO v_seats FROM public.users WHERE company_id = v_company AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_pipeline_count FROM public.pipelines WHERE company_id = v_company AND deleted_at IS NULL;

  SELECT COALESCE(bp.limits, '{}') INTO v_limits
  FROM public.billing_plans bp WHERE bp.code = v_billing.plan_code;

  v_member_limit   := public._company_member_limit(v_company);
  v_pipeline_limit := public._company_pipeline_limit(v_company);

  RETURN jsonb_build_object(
    'billing', jsonb_build_object(
      'plan_code',           v_billing.plan_code,
      'status',              v_billing.status,
      'seats',               v_billing.seats,
      'active_members',      v_seats,
      'member_limit',        CASE WHEN v_member_limit   = -1 THEN NULL ELSE v_member_limit   END,
      'storage_used_bytes',  v_billing.storage_used_bytes,
      'pipeline_count',      v_pipeline_count,
      'pipeline_limit',      CASE WHEN v_pipeline_limit = -1 THEN NULL ELSE v_pipeline_limit END,
      'external_provider',   v_billing.external_provider,
      'current_period_end',  v_billing.current_period_end,
      'trial_ends_at',       v_billing.trial_ends_at,
      'connected',           v_billing.external_subscription_id IS NOT NULL
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
