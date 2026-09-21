-- Issue #414 Task 5: company-scoped notification defaults.
--
-- Existing company_id-null rules are retained as legacy platform rules so
-- existing workspaces do not lose notifications. New defaults and all new
-- admin-created rules are company-owned and are visible only inside that
-- company. The catalog supplies fresh-company rules; notification_preferences
-- remains a per-user preference table, not a platform default.

ALTER TABLE public.notification_rules
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS catalog_key text,
  ADD COLUMN IF NOT EXISTS catalog_version integer,
  ADD COLUMN IF NOT EXISTS baseline_hash text,
  ADD COLUMN IF NOT EXISTS is_platform_default boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notification_rules_company_event
  ON public.notification_rules (company_id, event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_rules_company_catalog_event
  ON public.notification_rules (company_id, catalog_key, catalog_version, event_type)
  WHERE company_id IS NOT NULL AND catalog_key IS NOT NULL AND catalog_version IS NOT NULL;

DO $catalog$
DECLARE
  v_payload jsonb := $notification_payload${"schema_version":1,"rules":[{"name":"Task Assigned","description":"Notify the assignee when a task is assigned to them.","event_type":"task.assigned","conditions":{},"recipient_strategies":["assignee"],"recipient_config":{},"is_active":true},{"name":"Task Mention","description":"Notify users when they are mentioned in a task comment.","event_type":"task.mentioned","conditions":{},"recipient_strategies":["specific_users"],"recipient_config":{},"is_active":true},{"name":"Submission Received","description":"Notify the task owner when work is submitted for review.","event_type":"task.submission_created","conditions":{},"recipient_strategies":["task_owner"],"recipient_config":{},"is_active":true}]}$notification_payload$::jsonb;
  v_existing public.platform_catalog_entries%rowtype;
BEGIN
  SELECT * INTO v_existing
    FROM public.platform_catalog_entries
   WHERE catalog_key = 'notification_rules.standard'
     AND version = 1;
  IF v_existing.catalog_key IS NULL THEN
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, owner_scope, classification,
      permission_boundary, customization_policy, update_policy,
      cloneable, editable, replaceable, existing_companies_affected,
      payload, content_hash, baseline_hash, publication_state, retired_at,
      lifecycle_state, published_at
    ) VALUES (
      'notification_rules.standard', 1, 'notification_rule_set', 'platform',
      'platform_curated_default', 'company', 'clone-to-company',
      'append-only-explicit-upgrade', true, false, false, false,
      v_payload, '', '', 'published', NULL, 'published', now()
    );
  ELSIF v_existing.payload <> v_payload THEN
    RAISE EXCEPTION 'notification_rules.standard v1 replay differs; refusing overwrite';
  END IF;
  INSERT INTO public.platform_catalog_heads (catalog_key, recommended_version, published_version)
  VALUES ('notification_rules.standard', 1, 1)
  ON CONFLICT (catalog_key) DO NOTHING;
  UPDATE public.platform_catalog_heads
     SET published_version = 1, updated_at = now()
   WHERE catalog_key = 'notification_rules.standard'
     AND recommended_version = 1
     AND published_version IS NULL;
END;
$catalog$;

CREATE OR REPLACE FUNCTION public.fn_seed_company_default_notification_rules(
  p_company_id uuid,
  p_created_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payload jsonb;
  v_rule jsonb;
  v_catalog_version integer;
  v_catalog_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('notifications:' || p_company_id::text, 414));
  SELECT e.payload, e.version, e.content_hash
    INTO v_payload, v_catalog_version, v_catalog_hash
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h ON h.catalog_key = e.catalog_key AND h.published_version = e.version
   WHERE e.catalog_key = 'notification_rules.standard'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'notification_rules.standard catalog entry is not published';
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(v_payload->'rules') AS r(value) LOOP
    INSERT INTO public.notification_rules (
      company_id, name, description, event_type, conditions,
      recipient_strategies, recipient_config, is_active, created_by,
      catalog_key, catalog_version, baseline_hash, is_platform_default
    ) VALUES (
      p_company_id, v_rule->>'name', v_rule->>'description', v_rule->>'event_type',
      COALESCE(v_rule->'conditions', '{}'::jsonb),
      ARRAY(SELECT jsonb_array_elements_text(v_rule->'recipient_strategies')),
      COALESCE(v_rule->'recipient_config', '{}'::jsonb),
      COALESCE((v_rule->>'is_active')::boolean, true), p_created_by,
      'notification_rules.standard', v_catalog_version, v_catalog_hash, true
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM public.fn_record_company_catalog_installation(
    p_company_id, 'notification_rules.standard', v_catalog_version,
    jsonb_build_object('event_types', (SELECT jsonb_agg(value->>'event_type') FROM jsonb_array_elements(v_payload->'rules'))),
    'company-bootstrap', p_created_by
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_default_notification_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.is_owner AND NEW.is_active THEN
    PERFORM public.fn_seed_company_default_notification_rules(NEW.company_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_users_seed_company_default_notification_rules ON public.users;
CREATE TRIGGER trg_users_seed_company_default_notification_rules
  AFTER INSERT OR UPDATE OF company_id ON public.users
  FOR EACH ROW WHEN (NEW.is_owner = true)
  EXECUTE FUNCTION public.trg_fn_seed_company_default_notification_rules();

DROP POLICY IF EXISTS "notification_rules: authenticated read" ON public.notification_rules;
CREATE POLICY "notification_rules: authenticated read"
  ON public.notification_rules FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (company_id IS NULL OR company_id = public.my_company_id())
  );

DROP POLICY IF EXISTS "notification_rules: manage_notifications insert" ON public.notification_rules;
CREATE POLICY "notification_rules: manage_notifications insert"
  ON public.notification_rules FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.my_company_id()
    AND public.fn_has_permission('manage_notifications')
  );

DROP POLICY IF EXISTS "notification_rules: manage_notifications update" ON public.notification_rules;
CREATE POLICY "notification_rules: manage_notifications update"
  ON public.notification_rules FOR UPDATE TO authenticated
  USING (company_id = public.my_company_id() AND public.fn_has_permission('manage_notifications'))
  WITH CHECK (company_id = public.my_company_id());

DROP POLICY IF EXISTS "notification_rules: manage_notifications delete" ON public.notification_rules;
CREATE POLICY "notification_rules: manage_notifications delete"
  ON public.notification_rules FOR DELETE TO authenticated
  USING (company_id = public.my_company_id() AND public.fn_has_permission('manage_notifications'));

DROP FUNCTION IF EXISTS public.rpc_create_notification_rule(TEXT, TEXT, TEXT, JSONB, TEXT[], JSONB, JSONB);
CREATE OR REPLACE FUNCTION public.rpc_create_notification_rule(
  p_name text, p_description text, p_event_type text, p_conditions jsonb,
  p_recipient_strategies text[], p_recipient_config jsonb,
  p_channels_override jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_rule_id uuid; v_company_id uuid := public.my_company_id();
BEGIN
  IF v_company_id IS NULL OR NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notification_rules (
    company_id, name, description, event_type, conditions,
    recipient_strategies, recipient_config, channels_override, created_by
  ) VALUES (
    v_company_id, p_name, p_description, p_event_type, COALESCE(p_conditions, '{}'),
    p_recipient_strategies, COALESCE(p_recipient_config, '{}'), p_channels_override, auth.uid()
  ) RETURNING id INTO v_rule_id;
  RETURN v_rule_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_notification_rule(
  p_rule_id uuid, p_name text, p_description text, p_event_type text,
  p_conditions jsonb, p_recipient_strategies text[], p_recipient_config jsonb,
  p_channels_override jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notification_rules
     SET name = p_name, description = p_description, event_type = p_event_type,
         conditions = COALESCE(p_conditions, '{}'), recipient_strategies = p_recipient_strategies,
         recipient_config = COALESCE(p_recipient_config, '{}'), channels_override = p_channels_override,
         updated_at = now()
   WHERE id = p_rule_id
     AND company_id = public.my_company_id();
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_toggle_notification_rule(p_rule_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notification_rules
     SET is_active = p_is_active, updated_at = now()
   WHERE id = p_rule_id AND company_id = public.my_company_id();
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_delete_notification_rule(p_rule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.notification_rules
   WHERE id = p_rule_id AND company_id = public.my_company_id();
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_seed_company_default_notification_rules(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_create_notification_rule(text,text,text,jsonb,text[],jsonb,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_update_notification_rule(uuid,text,text,text,jsonb,text[],jsonb,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_toggle_notification_rule(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_delete_notification_rule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_notification_rule(text,text,text,jsonb,text[],jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_notification_rule(uuid,text,text,text,jsonb,text[],jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_toggle_notification_rule(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_delete_notification_rule(uuid) TO authenticated;
