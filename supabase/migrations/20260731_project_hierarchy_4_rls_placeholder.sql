-- 20260731_project_hierarchy_4_rls_placeholder.sql
--
-- ============================================================================
-- PLACEHOLDER — pending plan §11 (docs/PROJECT_HIERARCHY_PLAN.md), "Project
-- visibility". §11 flags that company-wide project visibility is *not*
-- acceptable once projects carry client identity + financial rollups, and
-- that the real access model (role-based / owner-based / portfolio-scoped)
-- needs a domain-expert answer to "can any auditor see any other auditor's
-- companies within a backoffice?" That answer does not exist yet.
--
-- Per issue #171 scope B: this migration gives clients / portfolios /
-- project_templates the SAME company-wide policy `projects_select` already
-- has today (`company_id = my_company_id() AND deleted_at IS NULL`) — no
-- worse than the status quo, not a new decision. When §11 is answered,
-- REPLACE THIS FILE (or add a follow-up migration that DROPs and
-- re-CREATEs these three policies) — it is isolated on purpose so the real
-- policy can land in one place without archaeology through unrelated schema
-- migrations.
--
-- No INSERT/UPDATE/DELETE policies are added for these three tables. All
-- writes go through the SECURITY DEFINER RPCs in
-- 20260731_project_hierarchy_2_rpc_template.sql and
-- 20260731_project_hierarchy_3_rpc_instantiate.sql, which run their own
-- permission checks (has_permission('project.create') / ('project.delete') /
-- is_owner) and bypass RLS by definition. Direct table writes via
-- supabase-js from a client are therefore denied by default (RLS is enabled,
-- no write policy exists) — stricter than projects (which does have
-- projects_insert / projects_update), never looser. If a future screen needs
-- direct table writes (e.g. editing a client's notes inline), add scoped
-- policies then, alongside whatever §11 decides for projects itself.
-- ============================================================================

DROP POLICY IF EXISTS clients_select ON public.clients;
CREATE POLICY clients_select ON public.clients
  FOR SELECT USING (company_id = my_company_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS portfolios_select ON public.portfolios;
CREATE POLICY portfolios_select ON public.portfolios
  FOR SELECT USING (company_id = my_company_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS project_templates_select ON public.project_templates;
CREATE POLICY project_templates_select ON public.project_templates
  FOR SELECT USING (company_id = my_company_id() AND deleted_at IS NULL);
