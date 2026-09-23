-- Forward-only reporting run contract.
--
-- The existing rpc_request_report(text,jsonb) -> uuid signature remains the
-- client entry point. This migration adds server-owned immutable payloads,
-- optional idempotency, and private artifact metadata without changing the
-- legacy job status values or storage path for PDFs.

ALTER TABLE public.reporting_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS snapshot jsonb,
  ADD COLUMN IF NOT EXISTS manifest jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS reporting_jobs_idempotency_key
  ON public.reporting_jobs (company_id, requested_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.report_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.reporting_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('html', 'pdf')),
  object_path text NOT NULL,
  renderer_version text NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, format),
  UNIQUE (object_path)
);

ALTER TABLE public.report_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_artifacts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.report_artifacts TO authenticated;

DROP POLICY IF EXISTS report_artifacts_requester_select ON public.report_artifacts;
CREATE POLICY report_artifacts_requester_select
  ON public.report_artifacts FOR SELECT TO authenticated
  USING (
    company_id = public.my_company_id()
    AND EXISTS (
      SELECT 1 FROM public.reporting_jobs j
      WHERE j.id = report_artifacts.job_id
        AND j.company_id = report_artifacts.company_id
        AND j.requested_by = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public._reporting_guard_snapshot_manifest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $guard$
BEGIN
  IF OLD.snapshot IS NOT NULL AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'report snapshots are immutable';
  END IF;
  IF OLD.manifest IS NOT NULL AND NEW.manifest IS DISTINCT FROM OLD.manifest THEN
    RAISE EXCEPTION 'report manifests are immutable';
  END IF;
  IF OLD.snapshot IS NULL AND NEW.snapshot IS NOT NULL
     AND current_setting('trustflow.reporting_snapshot_write', true) <> '1' THEN
    RAISE EXCEPTION 'report snapshots are server-owned';
  END IF;
  IF OLD.manifest IS NULL AND NEW.manifest IS NOT NULL
     AND current_setting('trustflow.reporting_snapshot_write', true) <> '1' THEN
    RAISE EXCEPTION 'report manifests are server-owned';
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_reporting_snapshot_manifest_guard ON public.reporting_jobs;
CREATE TRIGGER trg_reporting_snapshot_manifest_guard
  BEFORE UPDATE ON public.reporting_jobs
  FOR EACH ROW EXECUTE FUNCTION public._reporting_guard_snapshot_manifest();

-- Owner-only commit path for the trusted report worker. A required source is
-- never converted to a numeric zero: its absence makes the durable run fail.
CREATE OR REPLACE FUNCTION public._reporting_commit_snapshot_manifest(
  p_job_id uuid,
  p_snapshot jsonb,
  p_manifest jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $commit$
DECLARE
  v_job public.reporting_jobs%ROWTYPE;
  v_missing jsonb := COALESCE(p_snapshot #> '{provenance,missingRequiredSources}', '[]'::jsonb);
  v_status text;
  v_error text;
  v_artifact jsonb;
  v_format text;
  v_renderer text;
  v_checksum text;
  v_path text;
BEGIN
  SELECT * INTO v_job FROM public.reporting_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report job not found' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_snapshot) <> 'object' OR jsonb_typeof(p_manifest) <> 'object' THEN
    RAISE EXCEPTION 'snapshot and manifest must be JSON objects' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot->>'snapshotId' IS NULL OR p_manifest->>'runId' IS NULL
     OR p_snapshot->'scope'->>'companyId' IS DISTINCT FROM v_job.company_id::text THEN
    RAISE EXCEPTION 'snapshot/manifest identity or company scope is invalid' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_missing) <> 'array' THEN
    RAISE EXCEPTION 'provenance.missingRequiredSources must be an array' USING ERRCODE = '22023';
  END IF;
  IF v_job.snapshot IS NOT NULL OR v_job.manifest IS NOT NULL THEN
    IF v_job.snapshot = p_snapshot AND v_job.manifest = p_manifest THEN
      RETURN jsonb_build_object('job_id', p_job_id, 'status', v_job.status,
                                'snapshot', v_job.snapshot, 'manifest', v_job.manifest);
    END IF;
    RAISE EXCEPTION 'report snapshot/manifest already committed' USING ERRCODE = '23505';
  END IF;

  v_status := CASE WHEN jsonb_array_length(v_missing) > 0 THEN 'failed' ELSE 'completed' END;
  v_error := CASE WHEN v_status = 'failed'
                  THEN 'required report source unavailable: ' || v_missing::text END;
  PERFORM set_config('trustflow.reporting_snapshot_write', '1', true);
  UPDATE public.reporting_jobs
     SET snapshot = p_snapshot,
         manifest = p_manifest,
         status = v_status,
         error_log = v_error,
         started_at = COALESCE(started_at, now()),
         completed_at = now(),
         updated_at = now()
   WHERE id = p_job_id;

  IF jsonb_typeof(COALESCE(p_manifest->'artifacts', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'manifest.artifacts must be an array' USING ERRCODE = '22023';
  END IF;
  FOR v_artifact IN SELECT value FROM jsonb_array_elements(COALESCE(p_manifest->'artifacts', '[]'::jsonb)) LOOP
    v_format := v_artifact->>'format';
    v_renderer := v_artifact->>'rendererVersion';
    v_checksum := v_artifact->>'checksum';
    IF v_format NOT IN ('html', 'pdf') OR v_renderer IS NULL OR v_checksum IS NULL THEN
      RAISE EXCEPTION 'manifest artifact is missing format, rendererVersion, or checksum' USING ERRCODE = '22023';
    END IF;
    v_path := v_job.company_id::text || '/' || v_job.id::text || CASE WHEN v_format = 'pdf' THEN '.pdf' ELSE '.html' END;
    INSERT INTO public.report_artifacts(job_id, company_id, format, object_path, renderer_version, checksum)
    VALUES (v_job.id, v_job.company_id, v_format, v_path, v_renderer, v_checksum);
  END LOOP;
  RETURN jsonb_build_object('job_id', p_job_id, 'status', v_status,
                            'snapshot', p_snapshot, 'manifest', p_manifest);
END;
$commit$;

REVOKE ALL ON FUNCTION public._reporting_commit_snapshot_manifest(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reporting_guard_snapshot_manifest() FROM PUBLIC, anon, authenticated, service_role;

-- Add artifact paths to the existing private storage boundary while retaining
-- the legacy company/job.pdf path used by older report workers.
DROP POLICY IF EXISTS reports_storage_select ON storage.objects;
CREATE POLICY reports_storage_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
));
DROP POLICY IF EXISTS reports_storage_insert ON storage.objects;
CREATE POLICY reports_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
));
DROP POLICY IF EXISTS reports_storage_update ON storage.objects;
CREATE POLICY reports_storage_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
))
WITH CHECK (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
));

DROP POLICY IF EXISTS reports_storage_select_boundary ON storage.objects;
CREATE POLICY reports_storage_select_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
));
DROP POLICY IF EXISTS reports_storage_insert_boundary ON storage.objects;
CREATE POLICY reports_storage_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
));
DROP POLICY IF EXISTS reports_storage_update_boundary ON storage.objects;
CREATE POLICY reports_storage_update_boundary ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
))
WITH CHECK (bucket_id = 'reports' AND EXISTS (
  SELECT 1 FROM public.reporting_jobs j
  LEFT JOIN public.report_artifacts a ON a.job_id = j.id AND a.object_path = storage.objects.name
  WHERE j.company_id = public.my_company_id() AND j.requested_by = auth.uid()
    AND (a.id IS NOT NULL OR storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf')
));

-- Keep the legacy public RPC output and authorization contract, adding only
-- optional idempotency_key extraction from canonical serialized request input.
CREATE OR REPLACE FUNCTION public.rpc_request_report(
  p_report_type text,
  p_parameters jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $request$
DECLARE
  v_job_id uuid;
  v_existing_type text;
  v_existing_parameters jsonb;
  v_company_id uuid := public.my_company_id();
  v_safe_parameters jsonb := public.rpc_redact_report_parameters(COALESCE(p_parameters, '{}'::jsonb));
  v_idempotency_key text := NULLIF(COALESCE(p_parameters->>'idempotencyKey', p_parameters->>'idempotency_key'), '');
  v_valid_types text[] := ARRAY[
    'general', 'performance_audit', 'worker_comparison', 'team_comparison',
    'workflow_analysis', 'user_performance_series', 'user_performance_summary',
    'pipeline_stage_dwell', 'pipeline_throughput', 'personnel_comparison',
    'targets_status', 'personal_pulse', 'multi_report', 'projects'
  ];
BEGIN
  IF NOT (p_report_type = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'Unknown report type: %. Valid types: %', p_report_type, array_to_string(v_valid_types, ', ');
  END IF;
  IF v_company_id IS NULL OR NOT public.rpc_has_capability('report.generate') THEN
    RAISE EXCEPTION 'Report generation is not available for this user or plan' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.reporting_jobs(company_id, requested_by, report_type, parameters, idempotency_key)
  VALUES (v_company_id, auth.uid(), p_report_type, v_safe_parameters, v_idempotency_key)
  ON CONFLICT (company_id, requested_by, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    SELECT id, report_type, parameters INTO v_job_id, v_existing_type, v_existing_parameters
    FROM public.reporting_jobs
    WHERE company_id = v_company_id AND requested_by = auth.uid() AND idempotency_key = v_idempotency_key;
    IF v_existing_type IS DISTINCT FROM p_report_type OR v_existing_parameters IS DISTINCT FROM v_safe_parameters THEN
      RAISE EXCEPTION 'idempotency key is already bound to a different report request' USING ERRCODE = '23505';
    END IF;
    RETURN v_job_id;
  END IF;
  PERFORM public.log_event(v_company_id, auth.uid(), 'report', v_job_id, 'report.requested', v_safe_parameters);
  RETURN v_job_id;
END;
$request$;

REVOKE ALL ON FUNCTION public.rpc_request_report(text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_request_report(text, jsonb) TO authenticated;
