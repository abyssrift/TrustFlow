# Issue 414 completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the onboarding-checklist and real catalog-upgrade behavior left out of the first #414 implementation wave.

**Architecture:** Add one semantic `onboarding_checklist.workspace-ready` catalog entry and a shared parser used by the existing cross-platform ready step. Replace the generic ledger-only upgrade with a transaction-scoped coordinator that delegates to existing type-specific writers and records non-empty materialized references without changing prior company copies.

**Tech Stack:** PostgreSQL/Supabase RPCs and checks, Expo Router, React Native, TypeScript, Vitest.

## Global Constraints

- Do not rewrite existing company data.
- Keep `rpc_instantiate_template` as the bulk template-instantiation writer.
- Keep `rpc_create_starter_template` where starter-template materialization is appropriate.
- Do not embed company-specific pipeline IDs in platform templates.
- Keep fresh-company bootstrap idempotent and deterministic.
- Keep web/native onboarding behavior aligned.

---

### Task 1: Catalog-backed readiness checklist

**Files:**
- Create: `supabase/migrations/20260914090000_catalog_onboarding_checklist.sql`
- Create: `supabase/checks/check_catalog_onboarding_checklist.sql`
- Create: `lib/onboardingChecklist.ts`
- Create: `lib/onboardingChecklist.test.ts`
- Modify: `components/onboarding/WorkspaceReadyStep.tsx`
- Modify: `components/onboarding/WorkspaceReadyStep.test.tsx`
- Modify: `app/onboarding.tsx`
- Modify: `app/onboarding.web.tsx`
- Modify: `tests/onboarding.web.test.tsx`

**Interfaces:**
- `loadOnboardingChecklist(supabase)` reads only the published catalog head and
  returns normalized `{ key, title, description }[]` or a typed fallback state.
- `WorkspaceReadyStep` consumes `checklistItems` and never owns default text.

- [x] Write parser/component/SQL contract tests first and run them to observe the expected failures.
- [x] Add the semantic v1 catalog entry and its publication head; reject replay with a different payload.
- [x] Parse the entry in one shared helper and render the result from both onboarding variants.
- [x] Preserve the Continue action when the read fails and run focused tests plus Babel checks.

### Task 2: Real, safe catalog upgrade coordinator

**Files:**
- Create: `supabase/migrations/20260914090100_catalog_upgrade_materialization.sql`
- Create: `supabase/checks/check_catalog_upgrade_materialization.sql`
- Modify: existing catalog consumer migrations only where needed to route through shared private writers.

**Interfaces:**
- `rpc_adopt_platform_catalog_version(p_catalog_key text, p_version integer)` returns `{ installation_id, catalog_key, catalog_version, materialized_refs }`.
- The operation requires the company owner or `company.settings`, locks the
  company/key, creates resources before completing provenance, and returns the
  same refs on replay.

- [x] Add failing SQL scenarios for unauthorized access, empty-ledger repair,
  duplicate replay, owner preservation, v2 workflow addition, customized v1
  preservation, and rollback on a writer error.
- [x] Implement private type dispatch for role bundles, workflows, starter
  templates, notification rules, FileHub roots, and read-only checklist data.
- [x] Make bootstrap and quick-setup resolve published heads instead of hardcoding v1.
- [x] Make starter discovery select published-head versions only.
- [x] Run the focused SQL contract in the Docker database.

### Task 3: Integration and verification

**Files:**
- Modify: `docs/PLATFORM_DEFAULTS_CATALOG.md`
- Modify: `supabase/checks/check_platform_defaults_integration.sql`
- Modify: `docs/superpowers/reports/2026-09-13-issue-414-task-1-report.md`

- [x] Run all #414 SQL checks, focused Vitest, checkout-only Vitest, web export, Babel checks, `git diff --check`, and graphify update.
- [x] Run `npm run verify:agent`; distinguish unrelated detached-worktree failures from checkout failures.
- [x] Update issue #414 with the final catalog decisions, migrations, changed files, and exact verification results.
- [x] Provide a manual walkthrough at 1400px and 390px plus native, clearly marking any UI path not driven in this session.
