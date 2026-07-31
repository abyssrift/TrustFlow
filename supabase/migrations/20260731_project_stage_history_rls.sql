-- #172 Projects P2 -- RLS for project_stage_history.
--
-- Corrects a wrong assumption in 20260731_project_stage_history.sql, which
-- skipped RLS on the grounds that pipeline_stage_history has none. It does:
-- pipeline_stage_history is relrowsecurity = true with one policy,
--   stage_history_select FOR SELECT USING (company_id = my_company_id())
-- Without this, project_stage_history is readable cross-tenant over PostgREST
-- by any authenticated user.
--
-- Writes stay RPC-only (rpc_advance_project_stage is SECURITY DEFINER, so it
-- bypasses RLS) -- SELECT is the only policy needed, matching the task side.

ALTER TABLE public.project_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_stage_history_select ON public.project_stage_history;

CREATE POLICY project_stage_history_select
  ON public.project_stage_history
  FOR SELECT
  USING (company_id = public.my_company_id());
