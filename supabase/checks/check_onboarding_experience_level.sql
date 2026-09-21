-- Contract check for onboarding experience-level normalization and snapshot behavior.
BEGIN;

DO $check$
DECLARE
  v_uid uuid;
  v_company uuid;
  v_profile uuid;
  v_result jsonb;
  v_retry jsonb;
  v_before_result jsonb;
  v_existing_answers jsonb;
  v_existing_resolved jsonb;
  v_before_answers jsonb;
  v_before_resolved jsonb;
  v_existing_catalog jsonb;
  v_before_catalog_count integer;
  v_before_profile_count integer;
  v_before_installations jsonb;
  v_count integer;
  v_failed boolean;
  v_key uuid := gen_random_uuid();
BEGIN
  ASSERT to_regprocedure('public.rpc_create_company_and_link(text,jsonb,uuid)') IS NOT NULL,
    'three-argument company creation RPC missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_create_company_and_link(text,jsonb,uuid)', 'EXECUTE'),
    'three-argument company creation RPC ACL missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_create_company_and_link(text,jsonb,uuid)', 'EXECUTE'),
    'three-argument company creation RPC leaked to anon';

  SELECT u.id INTO v_uid
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
   LIMIT 1;
  ASSERT v_uid IS NOT NULL, 'no auth-backed public user available for contract check';
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  UPDATE public.users SET company_id = NULL, is_owner = false WHERE id = v_uid;

  v_result := public.rpc_create_company_and_link(
    'CHK onboarding experience guided',
    '{"size_band":"small","operating_models":["internal_operations"],"repeating_work":"rare"}'::jsonb,
    v_key
  );
  v_company := (v_result->>'company_id')::uuid;
  v_profile := (v_result->>'profile_id')::uuid;
  ASSERT (v_result->'answers'->>'experience_level') = 'guided',
    'missing experience level was not normalized to guided';
  ASSERT (v_result->'resolved_profile'->>'experience_level') = 'guided',
    'guided experience level missing from resolved profile';

  SELECT count(*) INTO v_count
    FROM public.company_onboarding_profiles
   WHERE company_id = v_company;
  ASSERT v_count = 1, 'guided create did not create exactly one onboarding snapshot';
  v_before_result := v_result;
  v_before_answers := v_result->'answers';
  v_before_resolved := v_result->'resolved_profile';
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordinal), '[]'::jsonb)
    INTO v_existing_catalog
    FROM public.company_onboarding_profile_catalog_entries e
   WHERE e.profile_id = v_profile;
  SELECT count(*) INTO v_before_catalog_count
    FROM public.company_onboarding_profile_catalog_entries e
   WHERE e.profile_id = v_profile;
  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.catalog_key), '[]'::jsonb)
    INTO v_before_installations
    FROM public.company_catalog_installations i
   WHERE i.company_id = v_company;

  v_retry := public.rpc_create_company_and_link(
    'ignored onboarding retry',
    '{"size_band":"small","operating_models":["internal_operations"],"experience_level":"full_control"}'::jsonb,
    v_key
  );
  ASSERT (v_retry->>'company_id')::uuid = v_company, 'idempotent retry changed company';
  ASSERT (v_retry->>'profile_id')::uuid = v_profile, 'idempotent retry changed profile';
  ASSERT v_retry = v_before_result, 'idempotent retry did not return the original JSON result';
  ASSERT v_retry->'answers' = v_before_answers, 'idempotent retry changed the original answers';
  SELECT count(*) INTO v_count
    FROM public.company_onboarding_profiles
   WHERE company_id = v_company;
  ASSERT v_count = 1, 'idempotent retry duplicated the onboarding snapshot';
  SELECT count(*) INTO v_count
    FROM public.company_onboarding_profile_catalog_entries e
   WHERE e.profile_id = v_profile;
  ASSERT v_count = v_before_catalog_count, 'idempotent retry changed catalog-entry count';
  ASSERT (
    SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordinal), '[]'::jsonb)
      FROM public.company_onboarding_profile_catalog_entries e
     WHERE e.profile_id = v_profile
  ) = v_existing_catalog, 'idempotent retry changed catalog-entry contents';

  UPDATE public.users SET company_id = NULL, is_owner = false WHERE id = v_uid;
  v_result := public.rpc_create_company_and_link(
    'CHK onboarding experience full control',
    '{"size_band":"small","operating_models":["internal_operations"],"experienceLevel":"full_control"}'::jsonb,
    gen_random_uuid()
  );
  ASSERT (v_result->'answers'->>'experience_level') = 'full_control',
    'legacy camelCase experienceLevel was not accepted';
  ASSERT (v_result->'resolved_profile'->>'experience_level') = 'full_control',
    'full_control experience level missing from resolved profile';

  v_company := (v_result->>'company_id')::uuid;
  v_profile := (v_result->>'profile_id')::uuid;
  SELECT count(*) INTO v_count
    FROM public.users u
   WHERE u.id = v_uid AND u.company_id = v_company AND u.is_owner;
  ASSERT v_count = 1, 'creator is not the company owner';
  SELECT count(*) INTO v_count
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = v_uid
     AND ur.company_id = v_company
     AND r.company_id = v_company
     AND r.name = 'Owner'
     AND r.deleted_at IS NULL;
  ASSERT v_count = 1, 'creator is not linked to exactly one company-owned Owner role';
  ASSERT public.has_permission('company.settings'), 'creator lost company.settings permission';
  SELECT count(*) INTO v_count
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE ur.user_id = v_uid
     AND ur.company_id = v_company
     AND r.company_id = v_company
     AND r.name = 'Owner'
     AND r.deleted_at IS NULL
     AND p.key = 'company.settings';
  ASSERT v_count >= 1, 'company-owned Owner role is not directly granted company.settings';

  v_before_answers := v_result->'answers';
  v_before_resolved := v_result->'resolved_profile';
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordinal), '[]'::jsonb)
    INTO v_existing_catalog
    FROM public.company_onboarding_profile_catalog_entries e
   WHERE e.profile_id = v_profile;
  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.catalog_key), '[]'::jsonb)
    INTO v_before_installations
    FROM public.company_catalog_installations i
   WHERE i.company_id = v_company;
  SELECT count(*) INTO v_before_profile_count
    FROM public.company_onboarding_profiles
   WHERE company_id = v_company;
  v_result := public.rpc_apply_onboarding_preset(
    '{"size_band":"small","operating_models":["internal_operations"],"experience_level":"guided"}'::jsonb,
    gen_random_uuid()
  );
  ASSERT (v_result->>'company_id')::uuid = v_company, 'explicit onboarding apply moved the company';
  SELECT count(*) INTO v_count
    FROM public.company_onboarding_profiles
   WHERE company_id = v_company;
  ASSERT v_count = v_before_profile_count + 1,
    'explicit onboarding apply did not create exactly one intentional new snapshot';
  SELECT answers, resolved_profile INTO v_existing_answers, v_existing_resolved
    FROM public.company_onboarding_profiles
   WHERE id = v_profile;
  ASSERT v_existing_answers = v_before_answers, 'pre-existing onboarding answers changed';
  ASSERT v_existing_resolved = v_before_resolved, 'pre-existing resolved profile changed';
  ASSERT (
    SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.ordinal), '[]'::jsonb)
      FROM public.company_onboarding_profile_catalog_entries e
     WHERE e.profile_id = v_profile
  ) = v_existing_catalog, 'pre-existing catalog installation changed';
  ASSERT (
    SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.catalog_key), '[]'::jsonb)
      FROM public.company_catalog_installations i
     WHERE i.company_id = v_company
  ) = v_before_installations, 'pre-existing company catalog installation changed';

  v_failed := false;
  BEGIN
    PERFORM public.rpc_apply_onboarding_preset(
      '{"size_band":"small","operating_models":["internal_operations"],"experience_level":"invalid"}'::jsonb,
      gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'invalid experience level was accepted';

  RAISE NOTICE 'check_onboarding_experience_level: normalization, idempotency, owner ACL, and snapshot preservation passed';
END;
$check$;

ROLLBACK;
