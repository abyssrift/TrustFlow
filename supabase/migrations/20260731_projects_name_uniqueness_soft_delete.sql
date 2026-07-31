-- Issue #180 (the projects half) — prerequisite for #179.
--
-- Split out of the Phase 1 work deliberately so it can ship WITHOUT the
-- projects/templates feature: #179 converts rpc_archive_project from a hard
-- DELETE to a soft delete, and the moment it does, an archived project keeps
-- its name reserved forever. Archive "Abdallah Group 2026", try to create it
-- again, and you get a duplicate-key error. Shipping #179 without this trades
-- a rare data-loss bug for a common workflow bug.
--
-- Reproduced on a local stack 2026-07-31 via the equivalent undo path:
--   first create  -> 3 projects
--   after undo    -> live projects = 0
--   RETRY FAILED  -> duplicate key on projects_company_id_name_key
--
-- Scoped to `projects` only. The sibling constraints on `clients` and
-- `portfolios` have the same defect but those tables do not exist in
-- production yet (verified: information_schema returns 0 rows for both), so
-- they stay in the Phase 1 branch where the tables are created.
--
-- Safe to apply ahead of #179 on its own: loosening a unique constraint can
-- never invalidate existing rows, and prod currently has zero soft-deleted
-- projects (every archive to date was a hard delete), so there is nothing
-- for the new predicate to newly permit.
--
-- NOT changed here: portfolios_company_idempotency_key stays total. An
-- idempotency key must keep blocking a replay even after its batch is undone.

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_company_id_name_key;
DROP INDEX IF EXISTS public.projects_company_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS projects_company_id_name_key
  ON public.projects (company_id, name)
  WHERE deleted_at IS NULL;
