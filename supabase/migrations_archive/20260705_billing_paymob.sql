-- PayMob integration: EGP pricing column, payment confirmation/renewal RPCs, daily cron.
--
-- SECRETS — set in Supabase Dashboard → Edge Functions → Secrets:
--   PAYMOB_API_KEY            from PayMob dashboard
--   PAYMOB_INTEGRATION_ID     card integration ID from PayMob
--   PAYMOB_IFRAME_ID          hosted iframe ID from PayMob
--   PAYMOB_HMAC_SECRET        HMAC secret from PayMob (Transaction Settings)
--   BILLING_PAYMOB_RENEW_SECRET  shared secret for the cron → Edge Function call
--     also store in Vault: SELECT vault.create_secret('<value>', 'billing_paymob_renew_secret');

-- ─── EGP pricing ─────────────────────────────────────────────────────────────
ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS price_egp_cents int NOT NULL DEFAULT 0;

-- Placeholder EGP prices — update these to your actual pricing before going live.
UPDATE public.billing_plans SET price_egp_cents = 0      WHERE code = 'free';
UPDATE public.billing_plans SET price_egp_cents = 59900  WHERE code = 'pro';       -- 599 EGP/seat/mo
UPDATE public.billing_plans SET price_egp_cents = 144900 WHERE code = 'business';  -- 1449 EGP/seat/mo
UPDATE public.billing_plans SET price_egp_cents = 0      WHERE code = 'enterprise';

-- ─── rpc_confirm_billing_payment ─────────────────────────────────────────────
-- Called by billing-webhook-paymob Edge Function (service role) after a
-- successful PayMob transaction. Upserts the billing row and logs the event.
CREATE OR REPLACE FUNCTION public.rpc_confirm_billing_payment(
  p_company_id      uuid,
  p_plan_code       text,
  p_paymob_order_id text,
  p_card_token      text,   -- saved card token for future recurring charges (null if not tokenized)
  p_amount_cents    int
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.company_billing (
    company_id, plan_code, status, external_provider,
    external_customer_id, external_subscription_id,
    current_period_end, trial_ends_at, updated_at
  )
  VALUES (
    p_company_id, p_plan_code, 'active', 'paymob',
    p_card_token, p_paymob_order_id,
    now() + interval '30 days', NULL, now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    plan_code                = EXCLUDED.plan_code,
    status                   = 'active',
    external_provider        = 'paymob',
    external_customer_id     = COALESCE(EXCLUDED.external_customer_id, company_billing.external_customer_id),
    external_subscription_id = EXCLUDED.external_subscription_id,
    current_period_end       = EXCLUDED.current_period_end,
    trial_ends_at            = NULL,
    updated_at               = now();

  INSERT INTO public.billing_events (company_id, type, plan_code, data)
  VALUES (p_company_id, 'payment_confirmed', p_plan_code, jsonb_build_object(
    'paymob_order_id', p_paymob_order_id,
    'amount_cents', p_amount_cents,
    'currency', 'EGP'
  ));

  RETURN jsonb_build_object('applied', true, 'plan_code', p_plan_code);
END;
$$;
-- No GRANT to authenticated — called only via service role by the webhook function.

-- ─── rpc_billing_renewals_due ────────────────────────────────────────────────
-- Returns companies whose PayMob subscription is due for renewal within 24 hours.
-- Called by billing-paymob-renew Edge Function (service role).
CREATE OR REPLACE FUNCTION public.rpc_billing_renewals_due()
RETURNS TABLE(
  company_id      uuid,
  plan_code       text,
  card_token      text,
  per_seat        boolean,
  price_egp_cents int,
  active_members  bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    cb.company_id,
    cb.plan_code,
    cb.external_customer_id                                         AS card_token,
    bp.per_seat,
    bp.price_egp_cents,
    (SELECT COUNT(*)::bigint FROM public.users u
     WHERE u.company_id = cb.company_id AND u.deleted_at IS NULL)  AS active_members
  FROM public.company_billing cb
  JOIN public.billing_plans   bp ON bp.code = cb.plan_code
  WHERE cb.plan_code            != 'free'
    AND cb.external_provider     = 'paymob'
    AND cb.external_customer_id IS NOT NULL
    AND cb.status               IN ('active', 'trialing')
    AND cb.current_period_end   IS NOT NULL
    AND cb.current_period_end   <= now() + interval '1 day'
  ORDER BY cb.current_period_end ASC;
END;
$$;
-- No GRANT to authenticated.

-- ─── rpc_record_renewal_charge ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_renewal_charge(
  p_company_id      uuid,
  p_plan_code       text,
  p_paymob_order_id text,
  p_amount_cents    int
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.company_billing SET
    status             = 'active',
    current_period_end = current_period_end + interval '30 days',
    updated_at         = now()
  WHERE company_id = p_company_id;

  INSERT INTO public.billing_events (company_id, type, plan_code, data)
  VALUES (p_company_id, 'renewal_charged', p_plan_code, jsonb_build_object(
    'paymob_order_id', p_paymob_order_id,
    'amount_cents', p_amount_cents,
    'currency', 'EGP'
  ));
END;
$$;

-- ─── rpc_mark_renewal_failed ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mark_renewal_failed(
  p_company_id uuid,
  p_plan_code  text,
  p_error      text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.company_billing SET
    status     = 'past_due',
    updated_at = now()
  WHERE company_id = p_company_id;

  INSERT INTO public.billing_events (company_id, type, plan_code, data)
  VALUES (p_company_id, 'renewal_failed', p_plan_code, jsonb_build_object('error', p_error));
END;
$$;

-- ─── Cron schedule ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.fn_invoke_billing_paymob_renew()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/billing-paymob-renew';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'billing_paymob_renew_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 60000
  );
END;
$function$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'billing-paymob-renew-daily';
SELECT cron.schedule(
  'billing-paymob-renew-daily',
  '0 2 * * *',
  $$SELECT public.fn_invoke_billing_paymob_renew();$$
);
