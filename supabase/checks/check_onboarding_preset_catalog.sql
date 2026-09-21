-- Contract check for the size/model onboarding catalog and its atomic API.
BEGIN;

DO $check$
DECLARE
  v_uid uuid;
  v_old_company uuid;
  v_company uuid;
  v_second_company uuid;
  v_key uuid := gen_random_uuid();
  v_result jsonb;
  v_retry jsonb;
  v_explicit jsonb;
  v_profile uuid;
  v_failed boolean;
  v_count integer;
BEGIN
  ASSERT to_regclass('public.company_onboarding_profiles') IS NOT NULL, 'profile table missing';
  ASSERT to_regclass('public.company_onboarding_profile_catalog_entries') IS NOT NULL, 'profile provenance table missing';
  ASSERT to_regclass('public.user_onboarding_drafts') IS NOT NULL, 'draft table missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_create_company_and_link(text,jsonb,uuid)', 'EXECUTE'), 'create overload ACL missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_apply_onboarding_preset(jsonb,uuid)', 'EXECUTE'), 'apply RPC ACL missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_create_company_and_link(text,jsonb,uuid)', 'EXECUTE'), 'create overload leaked to anon';
  ASSERT NOT has_function_privilege('authenticated', 'public.fn_apply_onboarding_preset(uuid,uuid,jsonb,uuid,text)', 'EXECUTE'), 'private apply helper exposed';

  v_failed := false;
  BEGIN
    PERFORM public.fn_onboarding_normalize_answers('{"size_band":"small","operating_models":["client_delivery"]}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%approval preference%', 'missing conditional answer has unclear error';
  END;
  ASSERT v_failed, 'missing conditional answer unexpectedly normalized';

  SELECT count(*) INTO v_count
    FROM public.platform_catalog_entries
   WHERE kind = 'onboarding_preset'
     AND catalog_key LIKE 'onboarding_preset.%'
     AND version = 1;
  ASSERT v_count = 10, 'expected manifest plus nine onboarding preset entries';
  ASSERT (SELECT published_version FROM public.platform_catalog_heads WHERE catalog_key = 'onboarding_preset.manifest') = 2,
    'manifest v2 is not the published head';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE e.catalog_key = 'onboarding_preset.manifest'
       AND e.version = 2
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(e.payload->'questions') question
          WHERE question->>'key' = 'gates'
            AND question->'visible_when'->>'answer' = 'operating_models'
       )
  ), 'manifest v2 is missing catalog-owned visibility predicates';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.platform_catalog_entries e
     WHERE e.kind = 'onboarding_preset'
       AND public._catalog_payload_has_uuid(e.payload)
  ), 'onboarding catalog contains a tenant UUID';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.platform_catalog_entries e
     WHERE e.kind = 'onboarding_preset'
       AND NOT EXISTS (SELECT 1 FROM public.platform_catalog_heads h WHERE h.catalog_key = e.catalog_key AND h.published_version >= e.version)
  ), 'onboarding entry has no published head';

  SELECT id, company_id INTO v_uid, v_old_company FROM public.users WHERE id IN (SELECT id FROM auth.users) LIMIT 1;
  ASSERT v_uid IS NOT NULL, 'no auth-backed public user available for contract check';
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  UPDATE public.users SET company_id = NULL, is_owner = false WHERE id = v_uid;

  v_result := public.rpc_create_company_and_link(
    'CHK onboarding preset',
    '{"size_band":"small","operating_models":["governed_regulatory","client_delivery"],"gates":"formal","time_tracking":"required","files":"governed","repeating_work":"frequent"}'::jsonb,
    v_key
  );
  v_company := (v_result->>'company_id')::uuid;
  v_profile := (v_result->>'profile_id')::uuid;
  ASSERT v_company IS NOT NULL AND v_profile IS NOT NULL, 'create API did not return company/profile IDs';
  ASSERT (v_result->>'revision')::integer = 1, 'first profile revision is not one';
  ASSERT jsonb_array_length(v_result->'applied') > 0, 'create API did not return applied bootstrap installations';
  ASSERT jsonb_array_length(v_result->'recommendations'->'workflow') > 0, 'create API did not return recommendations';
  ASSERT jsonb_array_length(v_result->'guarantees'->'admin') > 0, 'create API did not return admin guarantees';

  SELECT count(*) INTO v_count FROM public.company_onboarding_profile_catalog_entries WHERE profile_id = v_profile;
  ASSERT v_count = 3, 'profile did not record one size and two overlay catalog entries';
  SELECT count(*) INTO v_count FROM public.roles WHERE company_id = v_company AND name = 'Owner' AND deleted_at IS NULL;
  ASSERT v_count = 1, 'fresh preset company has no own Owner role';
  SELECT count(*) INTO v_count
    FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = v_uid AND ur.company_id = v_company AND r.company_id = v_company AND r.name = 'Owner';
  ASSERT v_count = 1, 'creator was not assigned the own-company Owner role';
  SELECT count(*) INTO v_count FROM public.pipelines WHERE company_id = v_company AND deleted_at IS NULL;
  ASSERT v_count >= 1, 'fresh preset company has no baseline workflow';

  v_retry := public.rpc_create_company_and_link('ignored on idempotent retry', '{"size_band":"small","operating_models":["client_delivery"],"gates":"none","time_tracking":"off","files":"light","repeating_work":"rare"}'::jsonb, v_key);
  ASSERT (v_retry->>'company_id')::uuid = v_company, 'committed retry created a different company';
  ASSERT (v_retry->>'profile_id')::uuid = v_profile, 'committed retry created a different profile';
  SELECT count(*) INTO v_count FROM public.company_onboarding_profiles WHERE company_id = v_company;
  ASSERT v_count = 1, 'committed retry duplicated the profile';

  v_explicit := public.rpc_apply_onboarding_preset(
    '{"size_band":"small","operating_models":["internal_operations"],"repeating_work":"sometimes"}'::jsonb,
    gen_random_uuid()
  );
  ASSERT (v_explicit->>'company_id')::uuid = v_company, 'explicit selection moved the company';
  ASSERT (v_explicit->>'revision')::integer = 2, 'explicit selection did not create a new profile revision';
  SELECT count(*) INTO v_count FROM public.company_onboarding_profiles WHERE company_id = v_company;
  ASSERT v_count = 2, 'explicit selection did not preserve the previous profile';

  v_failed := false;
  BEGIN
    UPDATE public.company_onboarding_profiles SET answers = '{}'::jsonb WHERE id = v_profile;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%immutable%', 'profile immutability error is unclear';
  END;
  ASSERT v_failed, 'profile update unexpectedly succeeded';

  RAISE NOTICE 'check_onboarding_preset_catalog: catalog, atomic create, owner assignment, provenance, and idempotent retry passed';
END;
$check$;

ROLLBACK;
