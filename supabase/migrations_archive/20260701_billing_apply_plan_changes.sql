-- Phase 1: Plan changes actually apply.
-- All non-enterprise plans apply immediately (honor-system until gateway connected).
-- Downgrades are guarded against current usage exceeding the new plan's limits.

CREATE OR REPLACE FUNCTION public.rpc_request_billing_change(
  p_plan_code text,
  p_action    text DEFAULT 'subscribe'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company           uuid := public.my_company_id();
  v_plan              public.billing_plans%rowtype;
  v_billing           public.company_billing%rowtype;
  v_members           int;
  v_pipelines         int;
  v_storage           bigint;
  v_new_max_members   int;
  v_new_max_pipelines int;
  v_new_max_storage   bigint;
  v_errors            jsonb := '[]'::jsonb;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT public._can_manage_billing() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown plan: %', p_plan_code; END IF;

  -- Enterprise always goes to sales
  IF v_plan.code = 'enterprise' THEN
    INSERT INTO public.billing_events (company_id, type, plan_code, created_by, data)
    VALUES (v_company, 'checkout_requested', v_plan.code, auth.uid(), jsonb_build_object('action', p_action));
    RETURN jsonb_build_object(
      'applied',       false,
      'contact_sales', true,
      'plan_code',     v_plan.code,
      'message',       'Contact sales to set up an Enterprise plan.'
    );
  END IF;

  -- Ensure billing row exists
  INSERT INTO public.company_billing (company_id) VALUES (v_company) ON CONFLICT (company_id) DO NOTHING;
  SELECT * INTO v_billing FROM public.company_billing WHERE company_id = v_company;

  -- No-op
  IF COALESCE(v_billing.plan_code, 'free') = v_plan.code THEN
    RETURN jsonb_build_object('applied', false, 'message', 'Already on this plan.', 'plan_code', v_plan.code);
  END IF;

  -- ── Downgrade guard ────────────────────────────────────────
  v_new_max_members   := CASE WHEN (v_plan.limits->>'max_members')      IS NULL THEN -1 ELSE (v_plan.limits->>'max_members')::int      END;
  v_new_max_pipelines := CASE WHEN (v_plan.limits->>'max_pipelines')     IS NULL THEN -1 ELSE (v_plan.limits->>'max_pipelines')::int     END;
  v_new_max_storage   := CASE WHEN (v_plan.limits->>'max_storage_bytes') IS NULL THEN -1 ELSE (v_plan.limits->>'max_storage_bytes')::bigint END;

  IF v_new_max_members > -1 THEN
    SELECT COUNT(*) INTO v_members FROM public.users WHERE company_id = v_company AND deleted_at IS NULL;
    IF v_members > v_new_max_members THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'resource', 'members',
        'current',  v_members,
        'limit',    v_new_max_members,
        'message',  format('You have %s members but %s allows %s. Remove members first.', v_members, v_plan.name, v_new_max_members)
      ));
    END IF;
  END IF;

  IF v_new_max_pipelines > -1 THEN
    SELECT COUNT(*) INTO v_pipelines FROM public.pipelines WHERE company_id = v_company AND deleted_at IS NULL;
    IF v_pipelines > v_new_max_pipelines THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'resource', 'pipelines',
        'current',  v_pipelines,
        'limit',    v_new_max_pipelines,
        'message',  format('You have %s pipelines but %s allows %s. Delete some first.', v_pipelines, v_plan.name, v_new_max_pipelines)
      ));
    END IF;
  END IF;

  IF v_new_max_storage > -1 THEN
    v_storage := COALESCE(v_billing.storage_used_bytes, 0);
    IF v_storage > v_new_max_storage THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'resource',      'storage',
        'current_bytes', v_storage,
        'limit_bytes',   v_new_max_storage,
        'message',       format('You are using %s MB but %s allows %s MB. Delete files first.',
                           round(v_storage::numeric / 1048576), v_plan.name, round(v_new_max_storage::numeric / 1048576))
      ));
    END IF;
  END IF;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object(
      'applied',   false,
      'blocked',   true,
      'plan_code', v_plan.code,
      'errors',    v_errors
    );
  END IF;

  -- ── Apply ──────────────────────────────────────────────────
  UPDATE public.company_billing
  SET plan_code                = v_plan.code,
      status                   = 'active',
      trial_ends_at            = NULL,
      external_subscription_id = NULL,
      current_period_end       = NULL,
      updated_at               = now()
  WHERE company_id = v_company;

  INSERT INTO public.billing_events (company_id, type, plan_code, created_by, data)
  VALUES (v_company, 'plan_changed', v_plan.code, auth.uid(), jsonb_build_object('action', p_action, 'from', v_billing.plan_code));

  RETURN jsonb_build_object('applied', true, 'plan_code', v_plan.code);
END;
$$;
