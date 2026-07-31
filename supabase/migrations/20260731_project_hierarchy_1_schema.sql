-- 20260731_project_hierarchy_1_schema.sql
-- Issue #171 (Phase 1 of #142, plan docs/PROJECT_HIERARCHY_PLAN.md §4 / §7).
-- New tables: clients, portfolios, project_templates.
-- New columns: projects.start_date, projects.client_id, projects.portfolio_id,
--              tasks.portfolio_id.
--
-- RLS for the three new tables is intentionally NOT in this file — see the
-- separate 20260731_project_hierarchy_4_rls_placeholder.sql, which is a
-- placeholder pending the open visibility question in plan §11.
-- All three tables have RLS enabled with NO policies below (default deny)
-- until that follow-up migration lands, so nothing is readable/writable via
-- PostgREST in between the two migrations landing.

-- ── clients: recurring subject, no lifecycle ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  external_ref       TEXT,
  notes              TEXT,
  standing_folder_id UUID REFERENCES public.filehub_folders(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  -- Judgment call: the plan says rpc_instantiate_template "upserts clients by
  -- name" but doesn't spell out the constraint that makes that an upsert
  -- rather than a race. This is it — ON CONFLICT (company_id, name) in the
  -- instantiate RPC depends on it.
  CONSTRAINT clients_company_name_key UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_clients_company ON public.clients (company_id) WHERE deleted_at IS NULL;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- ── portfolios: intake batch AND the bulk-instantiation undo batch ──────────
CREATE TABLE IF NOT EXISTS public.portfolios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  source          TEXT,
  received_at     TIMESTAMPTZ,
  target_date     TIMESTAMPTZ,
  manifest        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Hazard #2 (plan §7 / issue #171): a double-click doubles everything.
  -- idempotency_key is nullable (manual, non-bulk portfolios never set it);
  -- the UNIQUE constraint only actually constrains rows that do.
  idempotency_key TEXT,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT portfolios_company_idempotency_key UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_portfolios_company ON public.portfolios (company_id) WHERE deleted_at IS NULL;

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

-- ── project_templates: one jsonb body, read/written whole ───────────────────
CREATE TABLE IF NOT EXISTS public.project_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  -- body: jsonb array of
  --   { title, description?, pipeline_id?, category?, priority?, weight?,
  --     estimated_hours?, due_offset_days?, assignee_team_id? }
  -- Relative due_offset_days only, team-level assignment only, no
  -- interpolation/template language (plan §4).
  body        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_project_templates_company ON public.project_templates (company_id) WHERE deleted_at IS NULL;

ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;

-- ── projects: start_date (only lifecycle column this phase needs) + the two
--    pointers that make a project "belong to" a client and a portfolio ──────
-- Judgment call: the issue body's one-line column list only names
-- start_date + portfolio_id, but plan §3 ("a project sits at the
-- intersection of a client and a portfolio") and §7 ("upserts clients by
-- name") both require projects to actually point at a client — otherwise
-- the upsert has nothing to link to. Adding client_id here, scoped to what
-- Phase 1 needs (no current_stage_id/due_date/owner_id/etc — those are
-- Phase 2, plan §10).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS start_date   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_id    UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_client    ON public.projects (client_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_portfolio ON public.projects (portfolio_id) WHERE deleted_at IS NULL;

-- ── tasks: portfolio_id, denormalized so undo never has to join through
--    projects — this is what makes rollback a single-table sweep ───────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_portfolio ON public.tasks (portfolio_id) WHERE portfolio_id IS NOT NULL;

-- ── Reuse existing project.* permission keys ────────────────────────────────
-- No new permission keys: rpc_create_template_from_project and
-- rpc_instantiate_template gate on project.create (mirrors rpc_create_project);
-- rpc_undo_portfolio_instantiation gates on project.delete (mirrors the
-- existing delete-strength action). Split into project_template.* later if
-- firms need "can create projects but not save templates" as a distinct grant.
