-- Platform admin emails match PLATFORM_OWNERS in useControlPlaneData.ts.
-- No system_role column exists on public.users; check JWT email instead.

CREATE OR REPLACE FUNCTION public._is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (auth.jwt() ->> 'email') = ANY(ARRAY[
    'adamsamir2005@gmail.com',
    'adam.samir@trustedgellc.com',
    'adamsamir@hotmail.com'
  ])
$$;

DROP FUNCTION IF EXISTS public.rpc_generate_trial_code(text, int, int, timestamptz, text);
CREATE FUNCTION public.rpc_generate_trial_code(
  p_plan_code       text,
  p_duration_hours  int,
  p_max_redemptions int         DEFAULT 1,
  p_expires_at      timestamptz DEFAULT NULL,
  p_notes           text        DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_id   uuid;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE code = p_plan_code AND is_active = true) THEN
    RAISE EXCEPTION 'Unknown plan: %', p_plan_code;
  END IF;
  IF p_duration_hours < 1 OR p_duration_hours > 17520 THEN
    RAISE EXCEPTION 'Duration must be between 1 and 17520 hours.';
  END IF;

  v_code := upper(format('TF-%s-%sH-%s',
    p_plan_code, p_duration_hours,
    left(replace(gen_random_uuid()::text, '-', ''), 4)
  ));

  INSERT INTO public.trial_codes (code, plan_code, duration_hours, max_redemptions, expires_at, created_by, notes)
  VALUES (v_code, p_plan_code, p_duration_hours, p_max_redemptions, p_expires_at, auth.uid(), p_notes)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('code', v_code, 'id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_generate_trial_code(text, int, int, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_list_trial_codes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', tc.id, 'code', tc.code, 'plan_code', tc.plan_code,
      'duration_hours', tc.duration_hours, 'max_redemptions', tc.max_redemptions,
      'redeemed_count', tc.redeemed_count, 'expires_at', tc.expires_at,
      'notes', tc.notes, 'created_at', tc.created_at
    ) ORDER BY tc.created_at DESC)
    FROM public.trial_codes tc
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_list_trial_codes() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_revoke_trial_code(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  UPDATE public.trial_codes SET expires_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trial code not found.'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_trial_code(uuid) TO authenticated;
