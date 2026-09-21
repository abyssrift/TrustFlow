-- Issue #414 Task 5: company-scoped notification defaults contract.
BEGIN;

DO $check$
DECLARE
  v_company_id uuid;
  v_owner_id uuid;
  v_before integer;
  v_after integer;
  v_rule_id uuid;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'company_id'),
    'notification rules are missing company scope';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_rules_company_event'),
    'notification company/event index missing';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notification_rules_company_catalog_event'),
    'notification catalog uniqueness missing';
  ASSERT to_regprocedure('public.fn_seed_company_default_notification_rules(uuid,uuid)') IS NOT NULL,
    'notification default seeder missing';
  ASSERT EXISTS (
    SELECT 1 FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h ON h.catalog_key = e.catalog_key AND h.published_version = e.version
    WHERE e.catalog_key = 'notification_rules.standard'
      AND e.kind = 'notification_rule_set'
      AND e.payload->'rules' IS NOT NULL
  ), 'notification rule catalog entry is missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_create_notification_rule(text,text,text,jsonb,text[],jsonb,jsonb)', 'EXECUTE'),
    'notification create RPC leaked to anon';

  SELECT c.id INTO v_company_id FROM public.companies c LIMIT 1;
  SELECT u.id INTO v_owner_id FROM public.users u WHERE u.company_id = v_company_id AND u.is_owner LIMIT 1;
  IF v_company_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    SELECT count(*) INTO v_before FROM public.notification_rules WHERE company_id = v_company_id;
    PERFORM public.fn_seed_company_default_notification_rules(v_company_id, v_owner_id);
    SELECT count(*) INTO v_after FROM public.notification_rules WHERE company_id = v_company_id;
    ASSERT v_after = v_before + 3, format('expected three company notification defaults, added %s', v_after - v_before);
    PERFORM public.fn_seed_company_default_notification_rules(v_company_id, v_owner_id);
    ASSERT (SELECT count(*) FROM public.notification_rules WHERE company_id = v_company_id) = v_after,
      'notification default retry duplicated rows';
    ASSERT (SELECT count(*) FROM public.notification_rules WHERE company_id = v_company_id AND catalog_key = 'notification_rules.standard') = 3,
      'company notification rows lost catalog provenance';

    PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
    SELECT public.rpc_create_notification_rule(
      'Issue 414 check', 'company-owned rule', 'task.assigned', '{}', ARRAY['assignee'], '{}', NULL
    ) INTO v_rule_id;
    ASSERT (SELECT company_id FROM public.notification_rules WHERE id = v_rule_id) = v_company_id,
      'new notification rule was not company-owned';
    PERFORM public.rpc_toggle_notification_rule(v_rule_id, false);
    ASSERT NOT (SELECT is_active FROM public.notification_rules WHERE id = v_rule_id),
      'company notification rule did not remain editable';
  END IF;

  RAISE NOTICE 'check_company_notification_defaults: contract passed';
END;
$check$;

ROLLBACK;
