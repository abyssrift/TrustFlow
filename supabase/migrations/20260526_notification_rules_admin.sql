-- ====================================================================
-- Notification Rules — Admin RPCs
-- 1. rpc_delete_notification_rule  — delete a rule
-- 2. rpc_list_rule_deliveries      — recent deliveries for a rule's event_type
-- 3. rpc_simulate_notification_rule — server-side recipient resolution
-- ====================================================================

-- ── 1. rpc_delete_notification_rule ─────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_delete_notification_rule(UUID);
CREATE OR REPLACE FUNCTION public.rpc_delete_notification_rule(
  p_rule_id UUID
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

  DELETE FROM public.notification_rules
  WHERE id = p_rule_id;
END;
$$;

-- ── 2. rpc_list_rule_deliveries ─────────────────────────────────────
-- Returns recent notification deliveries for the given event_type so
-- admins can audit what fired. Limited by manage_notifications permission.
DROP FUNCTION IF EXISTS public.rpc_list_rule_deliveries(TEXT, INT);
CREATE OR REPLACE FUNCTION public.rpc_list_rule_deliveries(
  p_event_type TEXT,
  p_limit      INT DEFAULT 50
)
RETURNS TABLE (
  id             UUID,
  user_id        UUID,
  recipient_name TEXT,
  title          TEXT,
  body           TEXT,
  channels_sent  TEXT[],
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.user_id,
    COALESCE(u.display_name, u.full_name, u.email, 'Unknown user') AS recipient_name,
    n.title,
    n.body,
    n.channels_sent,
    n.read_at,
    n.created_at
  FROM public.notifications n
  LEFT JOIN public.users u ON u.id = n.user_id
  WHERE n.type = p_event_type
  ORDER BY n.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 200), 1);
END;
$$;

-- ── 3. rpc_simulate_notification_rule ───────────────────────────────
-- Mirrors the Edge Function's recipient resolution so the admin UI can
-- preview who would be notified without actually dispatching anything.
DROP FUNCTION IF EXISTS public.rpc_simulate_notification_rule(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.rpc_simulate_notification_rule(
  p_rule_id UUID,
  p_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule          public.notification_rules%ROWTYPE;
  v_strategy      TEXT;
  v_strategy_log  JSONB := '[]'::JSONB;
  v_strategy_ids  UUID[];
  v_all_ids       UUID[] := ARRAY[]::UUID[];
  v_recipients    JSONB;
  v_conditions_ok BOOLEAN := TRUE;
  v_cond_key      TEXT;
  v_task_id       UUID;
  v_pipeline_id   UUID;
  v_field         TEXT;
  v_role_name     TEXT;
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rule FROM public.notification_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rule not found' USING ERRCODE = 'P0002';
  END IF;

  p_payload := COALESCE(p_payload, '{}'::JSONB);

  -- Evaluate conditions (all keys must match payload exactly, like the Edge Function)
  FOR v_cond_key IN SELECT jsonb_object_keys(v_rule.conditions) LOOP
    IF v_rule.conditions -> v_cond_key IS DISTINCT FROM p_payload -> v_cond_key THEN
      v_conditions_ok := FALSE;
      EXIT;
    END IF;
  END LOOP;

  v_task_id := NULLIF(p_payload ->> 'task_id', '')::UUID;
  v_pipeline_id := NULLIF(p_payload ->> 'pipeline_id', '')::UUID;

  IF v_conditions_ok THEN
    FOREACH v_strategy IN ARRAY v_rule.recipient_strategies LOOP
      v_strategy_ids := ARRAY[]::UUID[];

      IF v_strategy = 'assignee' THEN
        IF v_task_id IS NOT NULL THEN
          SELECT COALESCE(array_agg(DISTINCT assignee_user_id), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.task_assignments
          WHERE  task_id = v_task_id
            AND  assignee_user_id IS NOT NULL;
        END IF;

      ELSIF v_strategy = 'task_owner' THEN
        IF v_task_id IS NOT NULL THEN
          SELECT COALESCE(array_agg(created_by), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.tasks
          WHERE  id = v_task_id
            AND  created_by IS NOT NULL;
        END IF;

      ELSIF v_strategy = 'watchers' THEN
        IF v_task_id IS NOT NULL THEN
          SELECT COALESCE(array_agg(DISTINCT user_id), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.entity_watchers
          WHERE  entity_type = 'task'
            AND  entity_id   = v_task_id;
        END IF;

      ELSIF v_strategy = 'pipeline_members' THEN
        IF v_pipeline_id IS NOT NULL THEN
          WITH pipeline_tasks AS (
            SELECT id FROM public.tasks
            WHERE pipeline_id = v_pipeline_id AND deleted_at IS NULL
          ),
          ids AS (
            SELECT assignee_user_id AS uid
            FROM   public.task_assignments
            WHERE  task_id IN (SELECT id FROM pipeline_tasks)
              AND  assignee_user_id IS NOT NULL
            UNION
            SELECT user_id
            FROM   public.task_participants
            WHERE  task_id IN (SELECT id FROM pipeline_tasks)
          )
          SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   ids;
        END IF;

      ELSIF v_strategy = 'role' THEN
        v_role_name := v_rule.recipient_config ->> 'role';
        IF v_role_name IS NOT NULL AND v_role_name <> '' THEN
          SELECT COALESCE(array_agg(DISTINCT ur.user_id), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.user_roles ur
          JOIN   public.roles r ON r.id = ur.role_id
          WHERE  r.name = v_role_name
            AND  ur.revoked_at IS NULL;
        END IF;

      ELSIF v_strategy = 'specific_users' THEN
        IF jsonb_typeof(v_rule.recipient_config -> 'user_ids') = 'array'
           AND jsonb_array_length(v_rule.recipient_config -> 'user_ids') > 0 THEN
          SELECT COALESCE(array_agg((value #>> '{}')::UUID), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   jsonb_array_elements(v_rule.recipient_config -> 'user_ids');
        ELSIF p_payload ? 'mentioned_user_id' THEN
          v_strategy_ids := ARRAY[NULLIF(p_payload ->> 'mentioned_user_id', '')::UUID];
        END IF;

      ELSIF v_strategy = 'payload_user' THEN
        v_field := v_rule.recipient_config ->> 'payload_field';
        IF v_field IS NOT NULL AND p_payload ? v_field THEN
          v_strategy_ids := ARRAY[NULLIF(p_payload ->> v_field, '')::UUID];
        END IF;
      END IF;

      -- Strip NULLs
      v_strategy_ids := COALESCE(
        ARRAY(SELECT x FROM unnest(v_strategy_ids) AS x WHERE x IS NOT NULL),
        ARRAY[]::UUID[]
      );

      v_strategy_log := v_strategy_log || jsonb_build_object(
        'strategy',     v_strategy,
        'resolved_count', cardinality(v_strategy_ids),
        'user_ids',     COALESCE(to_jsonb(v_strategy_ids), '[]'::JSONB)
      );

      v_all_ids := v_all_ids || v_strategy_ids;
    END LOOP;
  END IF;

  -- Deduplicate
  v_all_ids := COALESCE(
    ARRAY(SELECT DISTINCT x FROM unnest(v_all_ids) AS x),
    ARRAY[]::UUID[]
  );

  -- Build recipient detail list
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id',      u.id,
      'display_name', COALESCE(u.display_name, u.full_name, u.email, 'Unknown'),
      'email',        u.email
    ) ORDER BY COALESCE(u.display_name, u.full_name, u.email)
  ), '[]'::JSONB)
  INTO v_recipients
  FROM public.users u
  WHERE u.id = ANY(v_all_ids);

  RETURN jsonb_build_object(
    'rule_id',         v_rule.id,
    'event_type',      v_rule.event_type,
    'conditions_match', v_conditions_ok,
    'strategy_log',    v_strategy_log,
    'recipients',      v_recipients,
    'recipient_count', cardinality(v_all_ids)
  );
END;
$$;
