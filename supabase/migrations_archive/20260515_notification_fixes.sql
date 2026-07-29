-- ====================================================================
-- Notification Fixes
-- 1. Add revoked_at column to push_subscriptions
-- 2. Patch rpc_upsert_push_subscription to clear revoked_at on re-register
-- 3. Update dispatch trigger to pass auth header via vault (optional)
-- 4. Seed default notification rules for manual time events
-- ====================================================================

-- ── 1. revoked_at column ────────────────────────────────────────────
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- ── 2. rpc_upsert_push_subscription — clear revoked_at on re-register
DROP FUNCTION IF EXISTS public.rpc_upsert_push_subscription(TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.rpc_upsert_push_subscription(
  p_type      TEXT,
  p_token     TEXT,
  p_device_id TEXT,
  p_platform  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.push_subscriptions
    (user_id, type, token, device_id, platform, last_active_at)
  VALUES
    (auth.uid(), p_type, p_token, p_device_id, p_platform, now())
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    token          = EXCLUDED.token,
    type           = EXCLUDED.type,
    platform       = EXCLUDED.platform,
    last_active_at = now(),
    revoked_at     = NULL;
END;
$$;

-- ── 3. fn_trg_dispatch_notification_event — auth header via vault ────
-- To enable the auth gate on process-notification-event:
--   1. Generate a secret: SELECT gen_random_uuid();
--   2. Store in vault:    SELECT vault.create_secret('<value>', 'process_notification_secret');
--   3. Set in Edge Fn secrets: PROCESS_NOTIFICATION_SECRET = <same value>
-- Without vault setup the trigger sends an empty Bearer token and the
-- function skips the check (backward-compatible).

CREATE OR REPLACE FUNCTION public.fn_trg_dispatch_notification_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
  v_payload JSONB;
  v_secret  TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'process_notification_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  v_payload := jsonb_build_object(
    'type',       'INSERT',
    'table',      'notification_events',
    'schema',     'public',
    'record',     row_to_json(NEW)::JSONB,
    'old_record', NULL
  );

  PERFORM net.http_post(
    url     := v_url,
    body    := v_payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

-- ── fn_sweep_pending_notification_events — same auth header ──────────
CREATE OR REPLACE FUNCTION public.fn_sweep_pending_notification_events()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event  RECORD;
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'process_notification_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  FOR v_event IN
    SELECT *
    FROM   public.notification_events
    WHERE  processed_at IS NULL
      AND  created_at < now() - INTERVAL '30 seconds'
    ORDER BY created_at
    LIMIT 50
  LOOP
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'type',       'INSERT',
                   'table',      'notification_events',
                   'schema',     'public',
                   'record',     row_to_json(v_event)::JSONB,
                   'old_record', NULL
                 ),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_secret, '')
      ),
      timeout_milliseconds := 5000
    );
  END LOOP;
END;
$$;

-- ── 4. Default notification rules for manual time events ─────────────
DO $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT id INTO v_owner_id
  FROM   public.users
  WHERE  is_owner = TRUE
  LIMIT  1;

  IF v_owner_id IS NULL THEN
    RETURN;
  END IF;

  -- task.manual_time_flagged → notify the manager listed in the payload
  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, is_active, created_by)
  SELECT
    'Time Declaration Flagged',
    'Notify the task manager when a worker declares manual time exceeding expected limits.',
    'task.manual_time_flagged', '{}',
    ARRAY['payload_user'],
    '{"payload_field": "manager_id"}'::JSONB,
    TRUE, v_owner_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_rules
    WHERE event_type = 'task.manual_time_flagged'
  );

  -- task.manual_time_approved → notify the worker
  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, is_active, created_by)
  SELECT
    'Time Declaration Approved',
    'Notify the worker when their manual time declaration is approved.',
    'task.manual_time_approved', '{}',
    ARRAY['payload_user'],
    '{"payload_field": "worker_id"}'::JSONB,
    TRUE, v_owner_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_rules
    WHERE event_type = 'task.manual_time_approved'
  );

  -- task.manual_time_rejected → notify the worker
  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, is_active, created_by)
  SELECT
    'Time Declaration Rejected',
    'Notify the worker when their manual time declaration is rejected.',
    'task.manual_time_rejected', '{}',
    ARRAY['payload_user'],
    '{"payload_field": "worker_id"}'::JSONB,
    TRUE, v_owner_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_rules
    WHERE event_type = 'task.manual_time_rejected'
  );
END;
$$;
