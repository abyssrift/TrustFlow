-- #172 Projects P2 -- project lifecycle columns.
--
-- current_stage_id replaces the free-text status as the project's lifecycle
-- position (plan doc #142 sec 4/5). status itself is NOT dropped here -- see
-- the sequencing note in the issue: dropping it is a one-way commit and
-- several live readers/writers still exist (UI project-status picker,
-- board badges, dashboard/report queries). Additive only.
--
-- blocked / blocked_reason is a flag, not a stage -- it composes with any
-- stage in any vertical ("awaiting client" can happen during fieldwork or
-- during review). Confirmed with the domain in plan doc sec 5.
--
-- Uses ADD COLUMN IF NOT EXISTS: issue #171 (Phase 1, parallel work) also
-- adds columns to projects (start_date, portfolio_id) in its own migration
-- file. Distinct filenames + IF NOT EXISTS means neither migration can
-- clobber the other regardless of apply order.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS current_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_current_stage_id
  ON public.projects (current_stage_id);
