-- #172 Projects P2 -- project stage history (sibling table, not a widened
-- pipeline_stage_history).
--
-- Why a sibling table instead of adding subject polymorphism to the existing
-- pipeline_stage_history:
--   - pipeline_stage_history.task_id is NOT NULL with ON DELETE CASCADE to
--     tasks, and is read directly (task_id filter, no subject_kind guard) by
--     ~20+ SQL functions -- SLA risk, stage dwell, audit-stage reports,
--     rpc_get_task_details, archive/restore, delete-company cleanup -- plus
--     several frontend contexts/components. Making task_id nullable and
--     teaching every one of those readers to filter subject_kind = 'task' is
--     a wide, easy-to-miss blast radius for a P2 feature.
--   - A sibling table with the same shape is purely additive: zero risk to
--     any existing task-history reader, and it mirrors the exact pattern
--     rpc_advance_stage already uses for tasks. If a genuinely unified
--     "stage history" read model is ever needed, a view UNIONing both tables
--     is a two-line follow-up -- cheaper than un-breaking 20 call sites now.
--
-- This table is what makes "days in current stage" a free computation later
-- (plan doc #142 sec 5/8): MAX(transitioned_at) per project, grouped by
-- to_stage_id, gives stage-entry time with no extra bookkeeping column.

CREATE TABLE IF NOT EXISTS public.project_stage_history (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    pipeline_id      UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
    from_stage_id    UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
    to_stage_id      UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    transitioned_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    from_stage_name  TEXT,
    to_stage_name    TEXT,
    transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mirrors idx_stage_hist_* on pipeline_stage_history.
CREATE INDEX IF NOT EXISTS idx_project_stage_hist_project_id
  ON public.project_stage_history (project_id, transitioned_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_stage_hist_company_id
  ON public.project_stage_history (company_id, transitioned_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_stage_hist_pipeline_id
  ON public.project_stage_history (pipeline_id, transitioned_at DESC);

-- RLS is enabled in 20260731_project_stage_history_rls.sql (company-scoped
-- SELECT, mirroring pipeline_stage_history's stage_history_select). Writes
-- stay RPC-only via SECURITY DEFINER rpc_advance_project_stage.
