-- Plan Control (#58): admin-editable plan definitions.
-- billing_plans already backs member/pipeline/file-size limits (see 20260701_billing_*).
-- This migration (1) folds the last hardcoded piece — analytics feature gating,
-- previously a static object in lib/planLimits.ts — into billing_plans.limits so
-- it's editable through the same table, and (2) adds admin RPCs to list/upsert
-- plans. No payment gateway involved — pricing here is just a display number,
-- same as today's "records your interest" flow (see BillingPanel.tsx).

-- ─────────────────────────────────────────────────────────────
-- 1. Merge analytics_* keys into each plan's limits (values match the
--    previous hardcoded LIMITS table in lib/planLimits.ts).
-- ─────────────────────────────────────────────────────────────
UPDATE public.billing_plans SET limits = limits || jsonb_build_object(
  'analytics_max_days', 30, 'analytics_throughput', false, 'analytics_funnel', false,
  'analytics_personnel', false, 'analytics_personnel_export', false, 'analytics_reports', false
) WHERE code = 'free';

UPDATE public.billing_plans SET limits = limits || jsonb_build_object(
  'analytics_max_days', 90, 'analytics_throughput', true, 'analytics_funnel', false,
  'analytics_personnel', true, 'analytics_personnel_export', false, 'analytics_reports', true
) WHERE code = 'pro';

UPDATE public.billing_plans SET limits = limits || jsonb_build_object(
  'analytics_max_days', 365, 'analytics_throughput', true, 'analytics_funnel', true,
  'analytics_personnel', true, 'analytics_personnel_export', true, 'analytics_reports', true
) WHERE code = 'business';

UPDATE public.billing_plans SET limits = limits || jsonb_build_object(
  'analytics_max_days', NULL, 'analytics_throughput', true, 'analytics_funnel', true,
  'analytics_personnel', true, 'analytics_personnel_export', true, 'analytics_reports', true
) WHERE code = 'enterprise';

-- ─────────────────────────────────────────────────────────────
-- 2. Admin RPC: list every plan (including inactive) for editing.
--    Reuses the existing public._is_platform_admin() helper.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_list_billing_plans()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'code',        p.code,
             'name',        p.name,
             'description', p.description,
             'price_cents', p.price_cents,
             'currency',    p.currency,
             'interval',    p.interval,
             'per_seat',    p.per_seat,
             'sort_order',  p.sort_order,
             'is_active',   p.is_active,
             'features',    p.features,
             'limits',      p.limits
           ) ORDER BY p.sort_order)
    FROM public.billing_plans p
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_platform_list_billing_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_platform_list_billing_plans() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Admin RPC: create or update a plan definition by code.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_upsert_billing_plan(
  p_code        text,
  p_name        text,
  p_description text,
  p_price_cents int,
  p_currency    text,
  p_interval    text,
  p_per_seat    boolean,
  p_sort_order  int,
  p_is_active   boolean,
  p_features    jsonb,
  p_limits      jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION 'Plan code is required.';
  END IF;
  IF p_price_cents < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative.';
  END IF;

  INSERT INTO public.billing_plans (code, name, description, price_cents, currency, interval, per_seat, sort_order, is_active, features, limits)
  VALUES (p_code, p_name, p_description, p_price_cents, p_currency, p_interval, p_per_seat, p_sort_order, p_is_active, p_features, p_limits)
  ON CONFLICT (code) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    price_cents = EXCLUDED.price_cents,
    currency    = EXCLUDED.currency,
    interval    = EXCLUDED.interval,
    per_seat    = EXCLUDED.per_seat,
    sort_order  = EXCLUDED.sort_order,
    is_active   = EXCLUDED.is_active,
    features    = EXCLUDED.features,
    limits      = EXCLUDED.limits;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_platform_upsert_billing_plan(text, text, text, int, text, text, boolean, int, boolean, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_platform_upsert_billing_plan(text, text, text, int, text, text, boolean, int, boolean, jsonb, jsonb) TO authenticated;
