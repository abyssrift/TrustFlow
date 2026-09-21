-- Profile snapshots are company-readable but not directly mutable.
BEGIN;

DO $check$
DECLARE
  v_uid uuid;
  v_company uuid;
  v_profile uuid;
  v_failed boolean := false;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_onboarding_profiles' AND policyname = 'company_onboarding_profiles_read'), 'profile read policy missing';
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company_onboarding_profile_catalog_entries' AND policyname = 'company_onboarding_profile_catalog_read'), 'profile provenance read policy missing';
  ASSERT NOT has_table_privilege('authenticated', 'public.company_onboarding_profiles', 'INSERT'), 'profile insert leaked to authenticated';
  ASSERT NOT has_table_privilege('authenticated', 'public.company_onboarding_profiles', 'UPDATE'), 'profile update leaked to authenticated';
  ASSERT NOT has_table_privilege('authenticated', 'public.company_onboarding_profiles', 'DELETE'), 'profile delete leaked to authenticated';

  SELECT id INTO v_uid FROM public.users WHERE id IN (SELECT id FROM auth.users) LIMIT 1;
  ASSERT v_uid IS NOT NULL, 'no auth-backed user for profile check';
  SELECT company_id INTO v_company FROM public.users WHERE id = v_uid;
  ASSERT v_company IS NOT NULL, 'no company for profile check';
  SELECT id INTO v_profile FROM public.company_onboarding_profiles WHERE company_id = v_company ORDER BY revision LIMIT 1;
  IF v_profile IS NOT NULL THEN
    BEGIN
      UPDATE public.company_onboarding_profiles SET resolved_profile = '{}'::jsonb WHERE id = v_profile;
    EXCEPTION WHEN OTHERS THEN
      v_failed := true;
      ASSERT SQLERRM LIKE '%immutable%', 'profile trigger message is unclear';
    END;
    ASSERT v_failed, 'profile update unexpectedly succeeded';
  END IF;
  RAISE NOTICE 'check_company_onboarding_profiles: RLS, ACL, and immutable snapshot contract passed';
END;
$check$;

ROLLBACK;
