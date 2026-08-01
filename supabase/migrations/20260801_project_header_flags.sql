-- Issue #184: the /projects/[id] shared header needs plan §13.12's fixed,
-- composable flag set (blocked / awaiting_client / at_risk), not the single
-- `blocked` boolean the P2 lifecycle work (20260731_projects_lifecycle_
-- columns.sql) shipped before §13.12 was settled.
--
-- §13.12's shape: "one `flags text[]` with a CHECK on allowed values, plus
-- one note, not three booleans" -- and blocked/blocked_reason were meant to
-- fold into it. That fold is NOT done here. `blocked`/`blocked_reason` have
-- real, working readers this issue does not touch: rpc_projects_table (the
-- projects list badge), ProjectsTable.tsx, ProjectBlockedToggle.tsx, and the
-- (about to be superseded) ProjectDashboard(Sheet) popups. Migrating every
-- one of those in a route/tab-shell issue is exactly the scope creep #184
-- itself warns against ("structure, not contents"). So this is deliberately
-- additive only: a new `flags`/`flag_note` pair for the new header to read
-- and write, seeded from `blocked` so a project already flagged blocked
-- shows correctly in the new header. Reconciling the two representations
-- (dropping `blocked`/`blocked_reason` in favor of `flags` everywhere) is
-- flagged, not answered here -- same posture §13.14 took on
-- clients_select/portfolios_select.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS flags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS flag_note text;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_flags_allowed;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_flags_allowed
  CHECK (flags <@ ARRAY['blocked', 'awaiting_client', 'at_risk']::text[]);

-- One-time backfill: a project already marked blocked shows the same state
-- in the new header. Guarded so re-running the migration is a no-op instead
-- of clobbering a flag someone has since cleared via the new UI.
UPDATE public.projects
SET flags = ARRAY['blocked']::text[], flag_note = blocked_reason
WHERE blocked = true AND flags = '{}'::text[];
