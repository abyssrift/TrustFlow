-- Report capability/enforcement regression check.
-- Run only against a local database; the whole check is rolled back.
--
--   docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/checks/check_report_capability_enforcement.sql

BEGIN;

DO $$
DECLARE
  v_company       uuid := gen_random_uuid();
  v_owner         uuid := gen_random_uuid();
  v_member        uuid := gen_random_uuid();
  v_marker        text := 'report-capability-' || gen_random_uuid()::text;
  v_role          uuid := gen_random_uuid();
  v_permission    uuid;
  v_job           uuid;
  v_jobs_before   bigint;
  v_jobs_after    bigint;
  v_rejected      boolean;
  v_parameters    jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, v_marker || '-owner@test.invalid'),
    (v_member, v_marker || '-member@test.invalid');
  INSERT INTO public.companies (id, name, slug)
  VALUES (v_company, v_marker || ' company', v_marker);
  INSERT INTO public.users (id, company_id, email, full_name, is_owner, is_active) VALUES
    (v_owner, v_company, v_marker || '-owner@test.invalid', 'Report Capability Check Owner', true, true),
    (v_member, v_company, v_marker || '-member@test.invalid', 'Report Capability Check Member', false, true);

  INSERT INTO public.permissions (key, label, category)
  VALUES ('report.view', 'View reports (self-check)', 'self-check'),
         ('report.export', 'Export reports (self-check)', 'self-check'),
         ('report.generate', 'Generate reports (self-check)', 'self-check')
  ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;
  SELECT p.id INTO v_permission FROM public.permissions p WHERE p.key = 'report.view';
  INSERT INTO public.roles (id, company_id, name, is_system, created_by)
  VALUES (v_role, v_company, '__report_capability_check__', false, v_owner);
  INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_role, v_permission);
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role, id FROM public.permissions WHERE key = 'report.export';
  INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by)
  VALUES (v_member, v_role, v_company, v_owner);

  INSERT INTO public.billing_plans (code, name, limits, is_active)
  VALUES ('free', 'Self-check Free', '{"analytics_reports":false}'::jsonb, true),
         ('pro', 'Self-check Pro', '{"analytics_reports":true}'::jsonb, true)
  ON CONFLICT (code) DO UPDATE SET is_active = true, limits = EXCLUDED.limits;
  INSERT INTO public.company_billing (company_id, plan_code, status)
  VALUES (v_company, 'free', 'active')
  ON CONFLICT (company_id) DO UPDATE SET plan_code = 'free', status = 'active';
  UPDATE public.billing_plans SET is_active = true, limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{analytics_reports}', 'false'::jsonb)
  WHERE code = 'free';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  ASSERT NOT public.rpc_has_capability('report.generate'), 'free plan with qualifying permission must deny';
  v_jobs_before := (SELECT count(*) FROM public.reporting_jobs WHERE company_id = v_company);
  v_rejected := false;
  BEGIN
    v_job := public.rpc_request_report('general', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'free plan report request must be rejected';
  v_jobs_after := (SELECT count(*) FROM public.reporting_jobs WHERE company_id = v_company);
  ASSERT v_jobs_after = v_jobs_before, 'denied request must not create a job';

  UPDATE public.billing_plans SET limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{analytics_reports}', 'true'::jsonb)
  WHERE code = 'pro';
  UPDATE public.company_billing SET plan_code = 'pro', status = 'active' WHERE company_id = v_company;
  ASSERT NOT public.rpc_has_capability('report.generate'), 'view/export permissions alone must not grant generation';
  v_jobs_before := (SELECT count(*) FROM public.reporting_jobs WHERE company_id = v_company);
  v_rejected := false;
  BEGIN
    PERFORM public.rpc_request_report('general', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'view/export permissions alone must be rejected by the request RPC';
  v_jobs_after := (SELECT count(*) FROM public.reporting_jobs WHERE company_id = v_company);
  ASSERT v_jobs_after = v_jobs_before, 'view/export-only denial must not create a job';
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role, id FROM public.permissions WHERE key = 'report.generate';
  ASSERT public.rpc_has_capability('report.generate'), 'entitled active plan with generate permission must succeed';
  v_job := public.rpc_request_report('general', '{"salaries":{"user":100},"modules":[{"parameters":{"SaLaRy":200,"label":"kept"}}]}'::jsonb);
  ASSERT v_job IS NOT NULL, 'entitled request must return a job id';
  SELECT parameters INTO v_parameters FROM public.reporting_jobs WHERE id = v_job;
  ASSERT v_parameters = '{"modules":[{"parameters":{"label":"kept"}}]}'::jsonb,
    'job parameters must recursively omit salary inputs';
  ASSERT public.rpc_redact_report_parameters('{"salary":1,"safe":true}'::jsonb) = '{"safe":true}'::jsonb,
    'direct redaction helper must omit salary values';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  ASSERT public.rpc_has_capability('report.generate'), 'active owner may generate without role permission';

  DELETE FROM public.user_roles WHERE user_id = v_member;
  DELETE FROM public.team_members WHERE user_id = v_member;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  ASSERT NOT public.rpc_has_capability('report.generate'), 'permissionless member must deny';
  ASSERT NOT public.rpc_has_capability('report.unknown'), 'unknown capability must deny';
  UPDATE public.billing_plans SET limits = '{}'::jsonb WHERE code = 'pro';
  ASSERT NOT public.rpc_has_capability('report.generate'), 'missing entitlement must deny';
  UPDATE public.billing_plans SET limits = jsonb_build_object('analytics_reports', '"true"'::jsonb) WHERE code = 'pro';
  ASSERT NOT public.rpc_has_capability('report.generate'), 'malformed entitlement must deny';

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  ASSERT NOT public.rpc_has_capability('report.generate'), 'anonymous caller must deny';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  ASSERT NOT public.rpc_has_capability('report.generate'), 'caller without a company must deny';

  ASSERT has_function_privilege('authenticated', 'public.rpc_has_capability(text)', 'EXECUTE'), 'authenticated must execute capability RPC';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_has_capability(text)', 'EXECUTE'), 'anon must not execute capability RPC';
  ASSERT NOT has_function_privilege('public', 'public.rpc_has_capability(text)', 'EXECUTE'), 'PUBLIC must not execute capability RPC';
  ASSERT has_function_privilege('authenticated', 'public.rpc_request_report(text,jsonb)', 'EXECUTE'), 'authenticated must execute report RPC';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_request_report(text,jsonb)', 'EXECUTE'), 'anon must not execute report RPC';
  ASSERT NOT has_function_privilege('public', 'public.rpc_request_report(text,jsonb)', 'EXECUTE'), 'PUBLIC must not execute report RPC';
  ASSERT NOT has_function_privilege('authenticated', 'public.rpc_redact_report_parameters(jsonb)', 'EXECUTE'), 'redaction helper must not be directly callable by authenticated';

  RAISE NOTICE 'check_report_capability_enforcement.sql: ALL CHECKS PASSED';
END $$;

ROLLBACK;
