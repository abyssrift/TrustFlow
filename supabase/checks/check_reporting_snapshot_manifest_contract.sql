-- Rollback-only red contract checks for Task 2 reporting persistence.
-- Run only against a disposable local database.

BEGIN;

DO $$
DECLARE
  v_company uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_marker text := 'report-snapshot-' || gen_random_uuid()::text;
  v_role uuid := gen_random_uuid();
  v_job uuid;
  v_retry uuid;
  v_second uuid;
  v_snapshot jsonb := jsonb_build_object(
    'schemaVersion', 1,
    'snapshotId', gen_random_uuid()::text,
    'scope', jsonb_build_object('companyId', v_company::text),
    'provenance', jsonb_build_object('missingRequiredSources', '[]'::jsonb)
  );
  v_manifest jsonb;
  v_changed boolean := false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_user, v_marker || '@test.invalid');
  INSERT INTO public.companies(id,name,slug) VALUES (v_company, v_marker, v_marker);
  INSERT INTO public.users(id,company_id,email,full_name,is_owner,is_active)
  VALUES (v_user,v_company,v_marker || '@test.invalid','Reporting Snapshot Check',true,true);
  INSERT INTO public.permissions(key,label,category)
  VALUES ('report.generate','Generate reports (check)','self-check') ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.billing_plans(code,name,limits,is_active)
  VALUES ('__report_snapshot_check__','Report Snapshot Check','{"analytics_reports":true}'::jsonb,true)
  ON CONFLICT (code) DO UPDATE SET limits=EXCLUDED.limits,is_active=true;
  INSERT INTO public.company_billing(company_id,plan_code,status)
  VALUES (v_company,'__report_snapshot_check__','active') ON CONFLICT (company_id) DO UPDATE SET plan_code=EXCLUDED.plan_code,status='active';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_user,'role','authenticated')::text, true);

  -- Owner generation and the old UUID output key remain intact.
  v_job := public.rpc_request_report('general', jsonb_build_object('idempotencyKey','same-run','scope',jsonb_build_object('companyId',v_company::text)));
  v_retry := public.rpc_request_report('general', jsonb_build_object('idempotencyKey','same-run','scope',jsonb_build_object('companyId',v_company::text)));
  ASSERT v_job = v_retry, 'idempotent retry created a second run';
  v_second := public.rpc_request_report('general', jsonb_build_object('idempotencyKey','different-run'));
  ASSERT v_second <> v_job, 'different idempotency key reused the run';

  v_manifest := jsonb_build_object('manifestVersion',1,'runId',v_job::text,'status','succeeded','artifacts',jsonb_build_array(
    jsonb_build_object('format','pdf','rendererVersion','test','checksum','sha256:test')
  ));
  -- The private implementation is not callable through the API role.
  ASSERT NOT has_function_privilege('authenticated','public._reporting_commit_snapshot_manifest(uuid,jsonb,jsonb)','EXECUTE'),
    'snapshot commit implementation is exposed to authenticated';

  -- Required-source failure is represented as failed, never as zero data.
  v_snapshot := jsonb_set(v_snapshot,'{provenance,missingRequiredSources}', '["required.analytics"]'::jsonb);
  v_manifest := jsonb_set(v_manifest,'{status}','"failed"'::jsonb);
  v_manifest := jsonb_set(v_manifest,'{runId}',to_jsonb(v_job::text));
  PERFORM public._reporting_commit_snapshot_manifest(v_job,v_snapshot,v_manifest);
  ASSERT (SELECT status FROM public.reporting_jobs WHERE id=v_job)='failed', 'required source failure did not fail the run';
  ASSERT (SELECT error_log FROM public.reporting_jobs WHERE id=v_job) ILIKE '%required.analytics%', 'required source failure was not durable';
  ASSERT (SELECT count(*) FROM public.report_artifacts WHERE job_id=v_job)=1, 'manifest artifact was not recorded';

  BEGIN
    UPDATE public.reporting_jobs SET snapshot='{}'::jsonb WHERE id=v_job;
  EXCEPTION WHEN OTHERS THEN v_changed := true;
  END;
  ASSERT v_changed, 'immutable snapshot accepted an overwrite';

  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='reports_storage_select'),
    'private report storage select policy missing';
  -- Tenant isolation and capability/action separation are database contracts,
  -- not UI hints: the request action is authenticated-only and the snapshot
  -- writer is never an API action.
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='reporting_jobs'
      AND policyname='reporting_jobs_requester_boundary'
      AND qual ILIKE '%requested_by%' AND qual ILIKE '%company_id%'
      AND with_check ILIKE '%requested_by%' AND with_check ILIKE '%company_id%'
  ), 'reporting job tenant boundary missing';
  ASSERT has_function_privilege('authenticated','public.rpc_request_report(text,jsonb)','EXECUTE'),
    'authenticated report request action is not granted';
  ASSERT NOT has_function_privilege('anon','public.rpc_request_report(text,jsonb)','EXECUTE'),
    'anonymous report request action is granted';
  ASSERT NOT has_function_privilege('authenticated','public._reporting_commit_snapshot_manifest(uuid,jsonb,jsonb)','EXECUTE'),
    'authenticated can invoke the server snapshot action';
  ASSERT NOT (SELECT public FROM storage.buckets WHERE id='reports'), 'reports bucket must remain private';
  RAISE NOTICE 'check_reporting_snapshot_manifest_contract.sql: ALL CHECKS PASSED';
END $$;

ROLLBACK;
