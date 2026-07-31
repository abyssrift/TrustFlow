-- Issue #180: bulk-instantiate undo is not reversible.
--
-- rpc_undo_portfolio_instantiation soft-deletes (deleted_at), but
-- projects_company_id_name_key and clients_company_name_key are plain
-- UNIQUE (company_id, name) with no predicate. The soft-deleted rows keep
-- their names reserved, so re-creating the same companies after an undo
-- fails on a duplicate-key violation. Reproduced 2026-07-31:
--
--   first create  -> 3 projects
--   after undo    -> live projects = 0
--   RETRY FAILED  -> duplicate key value violates unique constraint
--                    "projects_company_id_name_key"
--
-- That is precisely the workflow undo exists for (plan §7 hazard 3: wrong
-- template -> undo -> create again), so the button currently reports success
-- and leaves the user unable to redo the work.
--
-- Fix: make the uniqueness predicates match how the rest of this schema
-- already treats deleted_at — a soft-deleted row is gone, and gone rows do
-- not reserve names. Every _select policy here already filters
-- `deleted_at IS NULL`, so nothing live can observe the archived duplicate.
--
-- DELIBERATELY NOT CHANGED: portfolios_company_idempotency_key stays a plain
-- UNIQUE. An idempotency key must keep blocking a replay even after the batch
-- it created is undone — making it partial would let the same key run twice,
-- which is the opposite of what §7 hazard 2 asks for.
--
-- Also unblocks #179: once rpc_archive_project soft-deletes instead of
-- hard-deleting, archiving a project and creating a new one with the same
-- name hits this identical wall.

-- ── projects ────────────────────────────────────────────────────────────────
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_company_id_name_key;
DROP INDEX IF EXISTS public.projects_company_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS projects_company_id_name_key
  ON public.projects (company_id, name)
  WHERE deleted_at IS NULL;

-- ── clients: name ───────────────────────────────────────────────────────────
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_company_name_key;
DROP INDEX IF EXISTS public.clients_company_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS clients_company_name_key
  ON public.clients (company_id, name)
  WHERE deleted_at IS NULL;

-- ── clients: external_ref (added by _5_ for gap 1) ───────────────────────────
-- NULL external_refs already don't collide in a unique index; the predicate
-- only adds the soft-delete condition.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_company_external_ref_key;
DROP INDEX IF EXISTS public.clients_company_external_ref_key;
CREATE UNIQUE INDEX IF NOT EXISTS clients_company_external_ref_key
  ON public.clients (company_id, external_ref)
  WHERE deleted_at IS NULL;
