-- #173 Projects P3 -- table-view columns on public.projects (plan §8/§9).
--
-- due_date / owner_id: plain pointers, same shape as their tasks.* siblings
-- (tasks.due_date is a bare TIMESTAMPTZ; tasks.owner is modeled via
-- created_by/manager_id -- there's no tasks.owner_id to mirror, so this
-- follows the FK style already used by projects.client_id/portfolio_id:
-- ON DELETE SET NULL, not CASCADE -- losing the owner user must not delete
-- the project).
--
-- weight: mirrors tasks.weight exactly (see 20260727_clamp_task_weight.sql)
-- -- BIGINT NOT NULL DEFAULT 1, CHECK 1..10. This is an input (relative
-- importance the user sets), not a rollup, so unlike tasks_total/
-- weighted_progress/tracked_seconds/estimated_hours it IS a stored column.
--
-- estimated_hours is deliberately NOT added here. Plan §3.3: every project
-- number is derived from its children or it drifts. rpc_projects_table
-- computes it as SUM(child tasks.estimated_hours) instead.
--
-- IF NOT EXISTS / ADD CONSTRAINT-with-guard throughout so this is safe to
-- run more than once and can't clobber a concurrent Phase 3 migration that
-- touches the same table (same reasoning as the Phase 1/2 column files).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weight   BIGINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_weight_1_10'
  ) THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_weight_1_10 CHECK (weight BETWEEN 1 AND 10);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_due_date ON public.projects (due_date) WHERE deleted_at IS NULL;

-- No rollup guard here (plan §3.3 / §13.2). §13.2's trigger pattern
-- (trg_projects_stage_history) enforces "only one writer" for a column
-- that already exists and can be written around (current_stage_id). There
-- is no equivalent target today: tasks_total, tasks_done, weighted_progress,
-- tracked_seconds and estimated_hours are never stored on public.projects --
-- rpc_projects_table computes all of them fresh from public.tasks on every
-- call. weight is excluded on purpose (it's the one new column here that
-- ISN'T a rollup). A trigger/constraint guarding columns that don't exist
-- would be speculative scaffolding for a hypothetical future column, not an
-- enforcement of a rule anything currently violates -- skipped; add a guard
-- like trg_projects_stage_history's the day a rollup value actually gets a
-- column.
