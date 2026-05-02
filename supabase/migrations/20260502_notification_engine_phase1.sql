-- ====================================================================
-- Notification Engine: Phase 1 — DB Foundation
-- Tables, RLS, indexes, signup trigger, RPCs (9), seeds
-- ====================================================================

-- ── Helper: reusable permission check (used in RLS + RPCs) ──────────
CREATE OR REPLACE FUNCTION public.fn_has_permission(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.user_roles ur
    JOIN   public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN   public.permissions p       ON p.id = rp.permission_id
    WHERE  ur.user_id    = auth.uid()
      AND  ur.revoked_at IS NULL
      AND  p.key         = p_key

    UNION ALL

    SELECT 1
    FROM   public.team_members tm
    JOIN   public.team_roles tr        ON tr.team_id = tm.team_id
    JOIN   public.role_permissions rp  ON rp.role_id = tr.role_id
    JOIN   public.permissions p        ON p.id = rp.permission_id
    WHERE  tm.user_id    = auth.uid()
      AND  tm.removed_at IS NULL
      AND  p.key         = p_key
  );
$$;

-- ── 1. notification_events (append-only event log) ──────────────────
CREATE TABLE IF NOT EXISTS public.notification_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,
  entity_id    UUID        NOT NULL,
  actor_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_type_processed
  ON public.notification_events (event_type, processed_at);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
-- No client-facing policies: written exclusively by SECURITY DEFINER
-- trigger functions, read by Edge Functions via service role key.

-- ── 2. notification_rules ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL,
  description          TEXT,
  event_type           TEXT        NOT NULL,
  conditions           JSONB       NOT NULL DEFAULT '{}',
  recipient_strategies TEXT[]      NOT NULL,
  recipient_config     JSONB       NOT NULL DEFAULT '{}',
  channels_override    JSONB,
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_rules: authenticated read" ON public.notification_rules;
CREATE POLICY "notification_rules: authenticated read"
  ON public.notification_rules FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "notification_rules: manage_notifications insert" ON public.notification_rules;
CREATE POLICY "notification_rules: manage_notifications insert"
  ON public.notification_rules FOR INSERT
  WITH CHECK (public.fn_has_permission('manage_notifications'));

DROP POLICY IF EXISTS "notification_rules: manage_notifications update" ON public.notification_rules;
CREATE POLICY "notification_rules: manage_notifications update"
  ON public.notification_rules FOR UPDATE
  USING (public.fn_has_permission('manage_notifications'));

DROP POLICY IF EXISTS "notification_rules: manage_notifications delete" ON public.notification_rules;
CREATE POLICY "notification_rules: manage_notifications delete"
  ON public.notification_rules FOR DELETE
  USING (public.fn_has_permission('manage_notifications'));

-- ── 3. entity_watchers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entity_watchers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT        NOT NULL,
  entity_id   UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_type, entity_id)
);

ALTER TABLE public.entity_watchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_watchers: own rows select" ON public.entity_watchers;
CREATE POLICY "entity_watchers: own rows select"
  ON public.entity_watchers FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "entity_watchers: own rows insert" ON public.entity_watchers;
CREATE POLICY "entity_watchers: own rows insert"
  ON public.entity_watchers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "entity_watchers: own rows delete" ON public.entity_watchers;
CREATE POLICY "entity_watchers: own rows delete"
  ON public.entity_watchers FOR DELETE
  USING (auth.uid() = user_id);

-- ── 4. notifications (delivery audit log) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  data          JSONB       NOT NULL DEFAULT '{}',
  read_at       TIMESTAMPTZ,
  channels_sent TEXT[]      NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications: own rows select" ON public.notifications;
CREATE POLICY "notifications: own rows select"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE for clients — service-role Edge Functions only.

-- ── 5. notification_preferences ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id             UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  push_mobile_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
  push_web_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_preferences: own row select" ON public.notification_preferences;
CREATE POLICY "notification_preferences: own row select"
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_preferences: own row update" ON public.notification_preferences;
CREATE POLICY "notification_preferences: own row update"
  ON public.notification_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- ── 6. push_subscriptions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL CHECK (type IN ('expo', 'web')),
  token          TEXT        NOT NULL,
  device_id      TEXT        NOT NULL,
  platform       TEXT        NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions: own rows select" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions: own rows select"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);
-- All writes via SECURITY DEFINER RPCs only.

-- ── Trigger: auto-create notification_preferences on new user ────────
CREATE OR REPLACE FUNCTION public.fn_auto_create_notification_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_notification_preferences ON public.users;
CREATE TRIGGER trg_auto_notification_preferences
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_create_notification_preferences();

-- ====================================================================
-- RPCs (all SECURITY DEFINER)
-- ====================================================================

-- ── 1. rpc_upsert_push_subscription ─────────────────────────────────
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
    last_active_at = now();
END;
$$;

-- ── 2. rpc_remove_push_subscription ─────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_remove_push_subscription(TEXT);
CREATE OR REPLACE FUNCTION public.rpc_remove_push_subscription(p_device_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_id = auth.uid() AND device_id = p_device_id;
END;
$$;

-- ── 3. rpc_mark_notification_read ────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_mark_notification_read(UUID);
CREATE OR REPLACE FUNCTION public.rpc_mark_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET    read_at = now()
  WHERE  id      = p_notification_id
    AND  user_id = auth.uid()
    AND  read_at IS NULL;
END;
$$;

-- ── 4. rpc_mark_all_notifications_read ──────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_mark_all_notifications_read();
CREATE OR REPLACE FUNCTION public.rpc_mark_all_notifications_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET    read_at = now()
  WHERE  user_id = auth.uid()
    AND  read_at IS NULL;
END;
$$;

-- ── 5. rpc_upsert_notification_preferences ───────────────────────────
DROP FUNCTION IF EXISTS public.rpc_upsert_notification_preferences(BOOLEAN, BOOLEAN, BOOLEAN);
CREATE OR REPLACE FUNCTION public.rpc_upsert_notification_preferences(
  p_email_enabled       BOOLEAN,
  p_push_mobile_enabled BOOLEAN,
  p_push_web_enabled    BOOLEAN
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

  INSERT INTO public.notification_preferences
    (user_id, email_enabled, push_mobile_enabled, push_web_enabled, updated_at)
  VALUES
    (auth.uid(), p_email_enabled, p_push_mobile_enabled, p_push_web_enabled, now())
  ON CONFLICT (user_id) DO UPDATE SET
    email_enabled       = EXCLUDED.email_enabled,
    push_mobile_enabled = EXCLUDED.push_mobile_enabled,
    push_web_enabled    = EXCLUDED.push_web_enabled,
    updated_at          = now();
END;
$$;

-- ── 6. rpc_create_notification_rule ─────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_create_notification_rule(TEXT, TEXT, TEXT, JSONB, TEXT[], JSONB, JSONB);
CREATE OR REPLACE FUNCTION public.rpc_create_notification_rule(
  p_name                 TEXT,
  p_description          TEXT,
  p_event_type           TEXT,
  p_conditions           JSONB,
  p_recipient_strategies TEXT[],
  p_recipient_config     JSONB,
  p_channels_override    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule_id UUID;
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, channels_override, created_by)
  VALUES
    (p_name, p_description, p_event_type,
     COALESCE(p_conditions, '{}'),
     p_recipient_strategies,
     COALESCE(p_recipient_config, '{}'),
     p_channels_override,
     auth.uid())
  RETURNING id INTO v_rule_id;

  RETURN v_rule_id;
END;
$$;

-- ── 7. rpc_update_notification_rule ─────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_update_notification_rule(UUID, TEXT, TEXT, TEXT, JSONB, TEXT[], JSONB, JSONB);
CREATE OR REPLACE FUNCTION public.rpc_update_notification_rule(
  p_rule_id              UUID,
  p_name                 TEXT,
  p_description          TEXT,
  p_event_type           TEXT,
  p_conditions           JSONB,
  p_recipient_strategies TEXT[],
  p_recipient_config     JSONB,
  p_channels_override    JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.notification_rules
  SET
    name                 = p_name,
    description          = p_description,
    event_type           = p_event_type,
    conditions           = COALESCE(p_conditions, '{}'),
    recipient_strategies = p_recipient_strategies,
    recipient_config     = COALESCE(p_recipient_config, '{}'),
    channels_override    = p_channels_override,
    updated_at           = now()
  WHERE id = p_rule_id;
END;
$$;

-- ── 8. rpc_toggle_notification_rule ─────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_toggle_notification_rule(UUID, BOOLEAN);
CREATE OR REPLACE FUNCTION public.rpc_toggle_notification_rule(
  p_rule_id   UUID,
  p_is_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.notification_rules
  SET is_active = p_is_active, updated_at = now()
  WHERE id = p_rule_id;
END;
$$;

-- ── 9. rpc_toggle_watcher ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_toggle_watcher(TEXT, UUID);
CREATE OR REPLACE FUNCTION public.rpc_toggle_watcher(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.entity_watchers
    WHERE user_id     = auth.uid()
      AND entity_type = p_entity_type
      AND entity_id   = p_entity_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.entity_watchers
    WHERE user_id     = auth.uid()
      AND entity_type = p_entity_type
      AND entity_id   = p_entity_id;
    RETURN jsonb_build_object('watching', false);
  ELSE
    INSERT INTO public.entity_watchers (user_id, entity_type, entity_id)
    VALUES (auth.uid(), p_entity_type, p_entity_id);
    RETURN jsonb_build_object('watching', true);
  END IF;
END;
$$;

-- ====================================================================
-- Seeds
-- ====================================================================

-- ── manage_notifications permission ──────────────────────────────────
INSERT INTO public.permissions (key, label, category)
VALUES ('manage_notifications', 'Manage Notification Rules', 'notifications')
ON CONFLICT (key) DO NOTHING;

-- ── Default notification rules ────────────────────────────────────────
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

  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, is_active, created_by)
  SELECT
    'Task Assigned',
    'Notify the assignee when a task is assigned to them.',
    'task.assigned', '{}', ARRAY['assignee'], '{}', TRUE, v_owner_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_rules
    WHERE event_type = 'task.assigned' AND name = 'Task Assigned'
  );

  -- Evaluator resolves recipient from payload.mentioned_user_id (Phase 3)
  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, is_active, created_by)
  SELECT
    'Task Mention',
    'Notify users when they are @mentioned in a task comment.',
    'task.mentioned', '{}', ARRAY['specific_users'], '{}', TRUE, v_owner_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_rules
    WHERE event_type = 'task.mentioned' AND name = 'Task Mention'
  );
END;
$$;