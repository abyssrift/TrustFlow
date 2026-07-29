-- ============================================================
-- Reports Engine v2 — Fix rpc_request_report permission block
--
-- Root cause: the old rpc_request_report was created via the
-- Supabase dashboard with a has_permission check that blocks
-- report generation. Additionally, CREATE OR REPLACE only
-- matches when parameter types are identical — the old function
-- used JSON while our replacement used JSONB, so both overloads
-- coexisted and the old gated version was still being invoked.
--
-- Fix:
--   1. DROP both overloads (JSON + JSONB) unconditionally
--   2. Re-create with JSONB, no permission gate — company
--      membership (enforced by company_id lookup) is the guard
--   3. Ensure reporting_jobs table exists
--   4. Seed report.generate permission + grant to admin role
-- ============================================================

-- 1. Drop all existing overloads of rpc_request_report
DROP FUNCTION IF EXISTS public.rpc_request_report(TEXT, JSON);
DROP FUNCTION IF EXISTS public.rpc_request_report(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.rpc_request_report(TEXT);

-- 2. Ensure reporting_jobs table exists
CREATE TABLE IF NOT EXISTS public.reporting_jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  report_type  TEXT        NOT NULL,
  parameters   JSONB       NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  file_url     TEXT,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reporting_jobs ENABLE ROW LEVEL SECURITY;

-- RLS: users can only see their own company's reports
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'reporting_jobs'
      AND policyname = 'reporting_jobs_company_isolation'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY reporting_jobs_company_isolation
        ON public.reporting_jobs
        USING (
          company_id = (
            SELECT company_id FROM public.users WHERE id = auth.uid()
          )
        )
    $pol$;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS reporting_jobs_company_created
  ON public.reporting_jobs (company_id, created_at DESC);

-- 3. Re-create rpc_request_report — no permission gate
--    Any authenticated user who belongs to a company may request a report.
--    The edge function enforces what data is included via RLS + company_id.
CREATE FUNCTION public.rpc_request_report(
  p_report_type TEXT,
  p_parameters  JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_job_id     UUID;
  v_valid_types TEXT[] := ARRAY[
    'general',
    'performance_audit',
    'worker_comparison',
    'team_comparison',
    'workflow_analysis',
    'user_performance_series',
    'user_performance_summary',
    'pipeline_stage_dwell',
    'pipeline_throughput',
    'personnel_comparison',
    'targets_status',
    'personal_pulse'
  ];
BEGIN
  IF NOT (p_report_type = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'Unknown report type: %. Valid types: %',
      p_report_type,
      array_to_string(v_valid_types, ', ');
  END IF;

  SELECT company_id INTO v_company_id
  FROM public.users
  WHERE id = auth.uid();

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with a company';
  END IF;

  INSERT INTO public.reporting_jobs (company_id, requested_by, report_type, parameters)
  VALUES (v_company_id, auth.uid(), p_report_type, p_parameters)
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_request_report(TEXT, JSONB) TO authenticated;

-- 4. Seed report.generate permission and grant it to the admin role
INSERT INTO public.permissions (key, label)
VALUES ('report.generate', 'Generate PDF Reports')
ON CONFLICT (key) DO NOTHING;

-- Grant to every role that already has system.view_all_data (i.e. admin-level roles)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM   public.role_permissions rp
JOIN   public.permissions op ON op.id = rp.permission_id AND op.key = 'system.view_all_data'
CROSS JOIN public.permissions p ON p.key = 'report.generate'
ON CONFLICT DO NOTHING;

-- Also grant to roles that have analytics.view
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM   public.role_permissions rp
JOIN   public.permissions op ON op.id = rp.permission_id AND op.key = 'analytics.view'
CROSS JOIN public.permissions p ON p.key = 'report.generate'
ON CONFLICT DO NOTHING;
