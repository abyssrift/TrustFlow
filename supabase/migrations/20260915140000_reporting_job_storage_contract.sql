-- Reporting job lifecycle and private report object access contract.
-- Keep legacy job data and preserve any additional, stricter live policies.

ALTER TABLE public.reporting_jobs
  ADD COLUMN IF NOT EXISTS error_log text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.reporting_jobs
  ALTER COLUMN error_log TYPE text USING error_log::text,
  ALTER COLUMN started_at TYPE timestamptz USING started_at::timestamptz,
  ALTER COLUMN completed_at TYPE timestamptz USING completed_at::timestamptz;

-- Older installs used error_msg. Copy it idempotently while retaining the legacy
-- column for rollback/older clients; removing stored error history is unnecessary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reporting_jobs' AND column_name = 'error_msg'
  ) THEN
    EXECUTE 'UPDATE public.reporting_jobs SET error_log = COALESCE(error_log, error_msg)';
  END IF;
END;
$$;

-- Recover useful lifecycle timestamps for historical rows without overwriting known values.
UPDATE public.reporting_jobs
SET started_at = COALESCE(started_at, updated_at, created_at)
WHERE status IN ('processing', 'completed', 'failed') AND started_at IS NULL;
UPDATE public.reporting_jobs
SET completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE status IN ('completed', 'failed') AND completed_at IS NULL;

-- A status constraint is part of the contract even on partial/legacy installs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reporting_jobs'::regclass
      AND conname = 'reporting_jobs_status_contract_check'
  ) THEN
    ALTER TABLE public.reporting_jobs
      ADD CONSTRAINT reporting_jobs_status_contract_check
      CHECK (status IN ('pending', 'processing', 'completed', 'failed')) NOT VALID;
    ALTER TABLE public.reporting_jobs VALIDATE CONSTRAINT reporting_jobs_status_contract_check;
  END IF;
END;
$$;

ALTER TABLE public.reporting_jobs ENABLE ROW LEVEL SECURITY;

-- Replace only the known historical company-wide policy. If a hosted install has
-- already tightened it, leave that stronger definition in place. PostgreSQL ORs
-- permissive policies, so don't add a second reader beside an unknown live policy.
DO $$
DECLARE v_qual text;
BEGIN
  SELECT qual INTO v_qual FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'reporting_jobs'
    AND policyname = 'reporting_jobs_company_isolation';
  IF FOUND AND COALESCE(v_qual, '') NOT ILIKE '%requested_by%' THEN
    DROP POLICY reporting_jobs_company_isolation ON public.reporting_jobs;
    CREATE POLICY reporting_jobs_company_isolation
      ON public.reporting_jobs FOR SELECT TO authenticated
      USING (requested_by = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reporting_jobs'
      AND cmd IN ('SELECT', 'ALL')
  ) THEN
    CREATE POLICY reporting_jobs_requester_select
      ON public.reporting_jobs FOR SELECT TO authenticated
      USING (requested_by = (SELECT auth.uid()));
  END IF;
END;
$$;

-- Restrictive guard keeps any unknown/hosted permissive policy from widening access.
-- The existing browser generator updates its own lifecycle row directly. Permit
-- only requester-owned updates; the restrictive policy below additionally binds
-- them to the caller's current tenant and prevents owner/company reassignment.
DROP POLICY IF EXISTS reporting_jobs_requester_update ON public.reporting_jobs;
CREATE POLICY reporting_jobs_requester_update
  ON public.reporting_jobs FOR UPDATE TO authenticated
  USING (requested_by = (SELECT auth.uid()))
  WITH CHECK (requested_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS reporting_jobs_requester_boundary ON public.reporting_jobs;
CREATE POLICY reporting_jobs_requester_boundary
  ON public.reporting_jobs AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
    AND company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
  )
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
  );

CREATE INDEX IF NOT EXISTS reporting_jobs_requester_created
  ON public.reporting_jobs (requested_by, created_at DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false;

-- Remove only policies owned by this migration; retain other live policies, with
-- the restrictive predicates below keeping them from widening this contract.
DROP POLICY IF EXISTS reports_storage_select ON storage.objects;
DROP POLICY IF EXISTS reports_storage_insert ON storage.objects;
DROP POLICY IF EXISTS reports_storage_update ON storage.objects;
DROP POLICY IF EXISTS reports_storage_select_boundary ON storage.objects;
DROP POLICY IF EXISTS reports_storage_insert_boundary ON storage.objects;
DROP POLICY IF EXISTS reports_storage_update_boundary ON storage.objects;

CREATE POLICY reports_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1
      FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND j.company_id::text = split_part(storage.objects.name, '/', 1)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  );
CREATE POLICY reports_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1
      FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND j.company_id::text = split_part(storage.objects.name, '/', 1)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  );
CREATE POLICY reports_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1 FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND j.company_id::text = split_part(storage.objects.name, '/', 1)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1 FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND j.company_id::text = split_part(storage.objects.name, '/', 1)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  );

-- Restrictive policies prevent any unrelated permissive policy from making report
-- objects public or tenant-wide. Storage upsert requires SELECT + INSERT + UPDATE.
CREATE POLICY reports_storage_select_boundary
  ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1 FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  );
CREATE POLICY reports_storage_insert_boundary
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1 FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  );
CREATE POLICY reports_storage_update_boundary
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1 FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1 FROM public.reporting_jobs j
      WHERE j.id::text || '.pdf' = split_part(storage.objects.name, '/', 2)
        AND storage.objects.name = j.company_id::text || '/' || j.id::text || '.pdf'
        AND j.company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
        AND j.requested_by = (SELECT auth.uid())
    )
  );
