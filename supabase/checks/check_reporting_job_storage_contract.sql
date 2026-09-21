-- Rollback-only contract check for reporting_jobs and the reports Storage bucket.
-- Creates isolated fixtures and rolls them back with the whole check.
-- Exercises authenticated RLS, not postgres/BYPASSRLS behavior.

BEGIN;

DO $$
DECLARE
  v_missing text[];
  v_status_ok boolean;
  v_error_type text;
  v_started_type text;
  v_completed_type text;
  v_status_default text;
BEGIN
  SELECT array_agg(required.column_name)
  INTO v_missing
  FROM (VALUES ('error_log'), ('started_at'), ('completed_at')) required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'reporting_jobs'
      AND c.column_name = required.column_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: reporting_jobs missing canonical columns %', v_missing;
  END IF;

  SELECT data_type INTO v_error_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reporting_jobs' AND column_name='error_log';
  SELECT data_type INTO v_started_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reporting_jobs' AND column_name='started_at';
  SELECT data_type INTO v_completed_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reporting_jobs' AND column_name='completed_at';
  SELECT column_default INTO v_status_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reporting_jobs' AND column_name='status';
  IF v_error_type <> 'text' OR v_started_type <> 'timestamp with time zone'
     OR v_completed_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'CHECK FAILED: canonical field types are error_log=%, started_at=%, completed_at=%',
      v_error_type, v_started_type, v_completed_type;
  END IF;
  IF v_status_default IS NULL OR v_status_default NOT ILIKE '%pending%' THEN
    RAISE EXCEPTION 'CHECK FAILED: reporting_jobs.status default is not pending (%).', v_status_default;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.reporting_jobs'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%pending%processing%completed%failed%'
  ) INTO v_status_ok;
  IF NOT v_status_ok THEN
    RAISE EXCEPTION 'CHECK FAILED: reporting_jobs status constraint does not preserve pending/processing/completed/failed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'reports' AND public IS FALSE) THEN
    RAISE EXCEPTION 'CHECK FAILED: reports bucket missing or public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.reporting_jobs'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'CHECK FAILED: reporting_jobs RLS is disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reporting_jobs'
      AND policyname='reporting_jobs_requester_boundary'
      AND qual ILIKE '%requested_by%' AND qual ILIKE '%company_id%'
      AND with_check ILIKE '%requested_by%' AND with_check ILIKE '%company_id%'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: reporting_jobs requester/tenant restrictive boundary is missing';
  END IF;

END;
$$;
CREATE TEMP TABLE reporting_contract_ctx (
  company_id uuid, other_company_id uuid,
  requester_id uuid, coworker_id uuid, outsider_id uuid,
  requester_job_id uuid, coworker_job_id uuid, foreign_job_id uuid
);
GRANT SELECT, INSERT ON reporting_contract_ctx TO authenticated;

DO $$
DECLARE
  c reporting_contract_ctx%ROWTYPE;
  marker text := 'reporting-job-contract-' || gen_random_uuid()::text;
BEGIN
  c.requester_id := gen_random_uuid();
  c.coworker_id := gen_random_uuid();
  c.outsider_id := gen_random_uuid();
  c.company_id := gen_random_uuid();
  c.other_company_id := gen_random_uuid();

  INSERT INTO auth.users (id, email) VALUES
    (c.requester_id, marker || '-requester@test.invalid'),
    (c.coworker_id, marker || '-coworker@test.invalid'),
    (c.outsider_id, marker || '-outsider@test.invalid');
  INSERT INTO public.companies (id, name, slug) VALUES
    (c.company_id, marker || ' company one', marker || '-one'),
    (c.other_company_id, marker || ' company two', marker || '-two');
  INSERT INTO public.users (id, company_id, email, full_name, is_owner, is_active) VALUES
    (c.requester_id, c.company_id, marker || '-requester@test.invalid', 'Reporting Contract Requester', false, true),
    (c.coworker_id, c.company_id, marker || '-coworker@test.invalid', 'Reporting Contract Coworker', false, true),
    (c.outsider_id, c.other_company_id, marker || '-outsider@test.invalid', 'Reporting Contract Outsider', false, true);

  INSERT INTO public.reporting_jobs(company_id, requested_by, report_type)
  VALUES (c.company_id, c.requester_id, 'general') RETURNING id INTO c.requester_job_id;
  INSERT INTO public.reporting_jobs(company_id, requested_by, report_type)
  VALUES (c.company_id, c.coworker_id, 'general') RETURNING id INTO c.coworker_job_id;
  INSERT INTO public.reporting_jobs(company_id, requested_by, report_type)
  VALUES (c.other_company_id, c.outsider_id, 'general') RETURNING id INTO c.foreign_job_id;
  INSERT INTO reporting_contract_ctx VALUES (c.company_id, c.other_company_id,
    c.requester_id, c.coworker_id, c.outsider_id,
    c.requester_job_id, c.coworker_job_id, c.foreign_job_id);
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', requester_id::text, true) FROM reporting_contract_ctx;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.reporting_jobs j
  WHERE j.id IN (
    SELECT requester_job_id FROM reporting_contract_ctx
    UNION ALL SELECT coworker_job_id FROM reporting_contract_ctx
    UNION ALL SELECT foreign_job_id FROM reporting_contract_ctx
  );
  IF n <> 1 THEN RAISE EXCEPTION 'CHECK FAILED: requester sees % fixture jobs; expected exactly own job', n; END IF;
END;
$$;

UPDATE public.reporting_jobs SET status = 'processing'
WHERE id = (SELECT requester_job_id FROM reporting_contract_ctx);
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.reporting_jobs
                 WHERE id = (SELECT requester_job_id FROM reporting_contract_ctx)
                   AND status = 'processing') THEN
    RAISE EXCEPTION 'CHECK FAILED: requester cannot update own report lifecycle row';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', requester_id::text, true) FROM reporting_contract_ctx;
UPDATE public.reporting_jobs SET status = 'failed', error_log = 'cross-user overwrite'
WHERE id = (SELECT coworker_job_id FROM reporting_contract_ctx);
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reporting_jobs WHERE id = (SELECT coworker_job_id FROM reporting_contract_ctx)
             AND (status = 'failed' OR error_log = 'cross-user overwrite')) THEN
    RAISE EXCEPTION 'CHECK FAILED: browser overwrote a same-company coworker job';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', outsider_id::text, true) FROM reporting_contract_ctx;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.reporting_jobs j
  WHERE j.id IN (
    SELECT requester_job_id FROM reporting_contract_ctx
    UNION ALL SELECT coworker_job_id FROM reporting_contract_ctx
    UNION ALL SELECT foreign_job_id FROM reporting_contract_ctx
  );
  IF n <> 1 THEN RAISE EXCEPTION 'CHECK FAILED: foreign-tenant requester sees % fixture jobs; expected exactly own job', n; END IF;
END;
$$;
UPDATE public.reporting_jobs SET status = 'failed', error_log = 'cross-tenant overwrite'
WHERE id = (SELECT requester_job_id FROM reporting_contract_ctx);
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reporting_jobs WHERE id = (SELECT requester_job_id FROM reporting_contract_ctx)
             AND (status = 'failed' OR error_log = 'cross-tenant overwrite')) THEN
    RAISE EXCEPTION 'CHECK FAILED: browser overwrote a cross-tenant job';
  END IF;
END;
$$;

-- Upsert uses all three commands. Predicates must bind access to the requester,
-- tenant, and reporting_jobs path; no DELETE policy is needed.
DO $$
DECLARE v_ops text[];
BEGIN
  SELECT array_agg(DISTINCT p.cmd)
  INTO v_ops
  FROM pg_policies p
  WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
    AND p.policyname ILIKE '%report%';
  IF NOT (v_ops @> ARRAY['SELECT','INSERT','UPDATE']) THEN
    RAISE EXCEPTION 'CHECK FAILED: reports Storage policies do not explicitly cover SELECT, INSERT, UPDATE (found %)', v_ops;
  END IF;
  IF 'DELETE' = ANY(COALESCE(v_ops, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'CHECK FAILED: reports Storage policies grant unnecessary DELETE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND p.policyname = 'reports_storage_select_boundary'
      AND p.qual ILIKE '%requested_by%'
      AND p.qual ILIKE '%company_id%'
      AND p.qual ILIKE '%reporting_jobs%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND p.policyname = 'reports_storage_insert_boundary'
      AND p.with_check ILIKE '%requested_by%'
      AND p.with_check ILIKE '%company_id%'
      AND p.with_check ILIKE '%reporting_jobs%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND p.policyname = 'reports_storage_update_boundary'
      AND p.qual ILIKE '%requested_by%'
      AND p.with_check ILIKE '%requested_by%'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED: report storage policies are not requester/company/job path scoped';
  END IF;
END;
$$;

ROLLBACK;
