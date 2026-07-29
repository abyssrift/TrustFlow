-- Public, unauthenticated read of the plan catalogue for the marketing site
-- (website/, deployed separately, anon key only — no logged-in user).
--
-- billing_plans already exists (see 20260623_billing_foundation.sql) but its
-- RLS policy requires auth.role() = 'authenticated', and rpc_billing_overview
-- requires a company context + billing permission — neither works for an
-- anonymous marketing-site visitor. This RPC exposes only the non-sensitive
-- catalogue columns (no company_billing/billing_events data), so the Plans
-- page never hand-copies prices and can't drift from what the app actually
-- charges.

CREATE OR REPLACE FUNCTION public.rpc_public_plans()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code',        p.code,
           'name',        p.name,
           'description', p.description,
           'price_cents', p.price_cents,
           'currency',    p.currency,
           'interval',    p.interval,
           'per_seat',    p.per_seat,
           'features',    p.features,
           'limits',      p.limits
         ) ORDER BY p.sort_order), '[]'::jsonb)
  FROM public.billing_plans p
  WHERE p.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_public_plans() TO anon, authenticated;
