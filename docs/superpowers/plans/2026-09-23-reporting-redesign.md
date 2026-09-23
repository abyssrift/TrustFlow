# Reporting Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a trustworthy HTML-first reporting experience, a separately laid-out PDF snapshot, and durable Pro scheduling without changing report semantics, tenant scope, or permissions through presentation.

**Architecture:** Introduce a renderer-neutral immutable report snapshot/manifest as the single source for the HTML reader and dedicated PDF renderer. Keep authoritative authorization, metric calculation, scheduling, storage, and retries server-side; keep the client as a capability-aware composer/history/calendar surface. Migrate incrementally from existing report components and RPC/storage contracts, preserving existing wrappers and ACL/company scope.

**Tech Stack:** Existing React Native/Web report components, `@react-pdf/renderer` dedicated PDF path, existing Supabase RPC/storage/auth patterns, repository capability/calendar/notification primitives, TypeScript tests, SQL transactional checks.

## Global Constraints

- Preserve existing Supabase `SECURITY DEFINER` wrappers, fixed `search_path`, ACLs, company/tenant scope, and capability checks; no production migration is applied by a worker.
- Follow the existing repository patterns first; do not create parallel permission, calendar, notification, uploader, cache, or modal systems.
- Undefined metrics are `N/A`/neutral; observed zero with a positive denominator remains zero; all-zero/no-outcome populations have no leader.
- HTML and PDF consume one immutable snapshot; PDF is never produced by HTML capture, browser print, or HTML-to-PDF conversion.
- Presentation profiles never widen permissions or alter formulas, filters, dataset scope, or snapshot values.
- Scheduled runs use the previous completed ISO week/month/calendar quarter, configured local run time and IANA timezone, month-day 29–31 clamp to month end, idempotent occurrence keys, bounded retry, no entitlement catch-up.
- Calendar markers use the existing app-wide calendar and are visible only to authorized report/schedule viewers; manage/trigger/view/download/recipient permissions remain distinct.
- Fail closed on authorization and required-source partial failures; do not silently present partial data as complete.
- Preserve all unrelated dirty/untracked worktree changes. Stage explicit paths only.
- Every worker reads `AGENTS.md`, `CLAUDE.md`, every `.agents/rules/*.md`, and `.agents/skills/sol-architect-orchestration/SKILL.md` before acting. UI workers also read the UI rules.

## File and package map

The following ownership is deliberately disjoint. Existing files may be adapted only by the package owner; shared integration edits are reserved for Sol after workers return.

- **Package A — canonical reporting contracts and metric semantics:** `lib/reporting/**`, new renderer-neutral report model files under `lib/reporting/`, and their tests/checks. Owns value status, provenance, periods, profiles, and snapshot serialization; no UI/PDF/database files.
- **Package B — report reader and authoring/history UX:** `components/intelligence/_reports_*.tsx`, `_ReportGenerator_*.tsx`, report history/reader components, and UI tests. Owns responsive HTML reader/composer/history states; no SQL, metric formulas, or PDF primitives.
- **Package C — dedicated PDF renderer/layout:** `components/intelligence/reports/shared.tsx`, `theme.ts`, report-specific PDF components and PDF tests/fixtures. Owns pagination, repeated headers, context, readable typography, chart fallbacks, and PDF structural/render checks; no authoring/history or SQL.
- **Package D — server snapshot/job/storage contract:** reporting RPC/function/migration/check files only, preserving existing wrappers/ACLs. Owns immutable snapshot/manifest/job lifecycle, private artifact access, idempotency, and required-source failure semantics; no UI/PDF component edits.
- **Package E — Pro schedules, recipients, notifications, and existing calendar:** schedule/job-trigger server files plus existing calendar/notification integration files and focused tests. Owns cadence/timezone/DST, entitlement, recipients, calendar visibility, retry/duplicate behavior; no renderer or metric edits.
- **Sol integration:** cross-package wiring, migration ordering, production/local mismatch reconciliation, complete diff review, final tests, and ledger/plan status.

## Task 1: Freeze canonical period, metric, and snapshot contracts

**Files:**
- Modify/create only within `lib/reporting/**` and its focused tests.
- Create: a renderer-neutral contract module in `lib/reporting/` following existing naming conventions.
- Test: `lib/reporting/*.test.ts` and a pure check if required by repository patterns.

**Interfaces:**
- Produces normalized report request, period, metric-value status, provenance, presentation-profile, snapshot, and manifest types consumed by later packages.
- Exposes pure period resolution for ISO week/month/calendar quarter and IANA-local run occurrence inputs; no Supabase client or React imports.

- [ ] Add explicit `observed | not_available | suppressed | failed` metric status and numerator/denominator/sample/caveat fields.
- [ ] Add tests for observed zero, zero denominator, null-heavy input, no leader, month-end clamp, quarter boundaries, leap day, and DST resolution policy.
- [ ] Add snapshot equality fixtures proving profile changes do not change values, scope, filters, or provenance.
- [ ] Run the focused reporting contract tests and `git diff --check` for owned files.

## Task 2: Server snapshot, manifest, and artifact access contract

**Files:**
- Modify/create only reporting Supabase migrations, RPC/function source, and `supabase/checks/check_reporting_*.sql` assigned to this package.
- Do not edit historical migrations or unrelated SQL.

**Interfaces:**
- Consumes canonical request/period semantics from Task 1 as serialized server inputs.
- Produces an immutable snapshot/manifest and durable job states with private artifact lookup; existing public wrapper signatures/output keys and ACL/company scope remain compatible.

- [ ] Write red checks inside `BEGIN`/`ROLLBACK` for tenant isolation, capability/action separation, immutable manifest fields, required-source failure, private artifact access, and idempotent run creation.
- [ ] Add one forward-only migration preserving `SECURITY DEFINER` wrappers, fixed `search_path`, owner-only private implementation, grants, and existing output keys.
- [ ] Implement the smallest compatible server contract; reject unknown/unauthorized scope and never coalesce required missing data into zero.
- [ ] Run the focused SQL check in the disposable local DB, `migration_drift.js`, and record Docker/CLI limitations without credentials or production access.

## Task 3: HTML reader and report authoring/history UX

**Files:**
- Modify only `components/intelligence/_reports_*.tsx`, `_ReportGenerator_*.tsx`, report reader/history components, and their tests.
- Reuse existing `Popup`/`DraggableSheet`, `Calendar`, `useCapability`, `useToast`, and existing loading/error/history patterns.

**Interfaces:**
- Consumes the immutable snapshot/manifest and capability state from Tasks 1–2.
- Produces a responsive HTML reader with manager/analyst/client-ready presentation selection that cannot expand scope.

- [ ] Add failing tests for explicit scope/period/freshness/methodology display, N/A vs zero, no leader, required-source error, retry state, and capability-separated controls.
- [ ] Implement summary-to-detail/appendix hierarchy, visible action/findings narrative, definitions/denominators, accessible chart alternatives, and mobile/tablet layouts.
- [ ] Fix clipped funnel labels, table context/state loss, misleading empty states, missing history error details, and generation-without-preview ambiguity identified in the audit.
- [ ] Test desktop, narrow web, keyboard/focus, loading/error/empty states, and no-authorization disclosure. Run focused report suite, Babel/safety checks, and web export/type checks where feasible.

## Task 4: Dedicated PDF layout and visual quality gates

**Files:**
- Modify only `components/intelligence/reports/shared.tsx`, `theme.ts`, report-specific PDF components, PDF fixtures, and PDF tests/checks.

**Interfaces:**
- Consumes exactly the snapshot/manifest renderer contract from Task 1; does not read HTML DOM or fetch live data.
- Produces a dedicated PDF artifact with stable report identity, page context, and renderer/version metadata.

- [ ] Add synthetic fixtures for empty, one-record, long labels, long text, large tables, null/zero metrics, many categories, non-Latin glyphs, and all-zero teams.
- [ ] Add failing structural assertions for repeated table headers, continued-section labels, page numbering/context, readable minimum sizes, no clipped labels/overflow/blank pages, and no false winner.
- [ ] Implement responsive page templates, wrapped/abbreviated funnel labels with full accessible labels, repeated headers, continuation context, content-aware whitespace, and minimum type/contrast rules.
- [ ] Render representative pages with the actual PDF renderer and inspect raster output/text extraction; do not claim visual verification from signature/size alone.

## Task 5: Durable Pro schedules and existing-calendar visibility

**Files:**
- Modify/create only schedule/job/notification server files, existing calendar integration files, and focused schedule/calendar tests.
- No report component or metric files.

**Interfaces:**
- Consumes canonical period resolution and snapshot/job contracts from Tasks 1–2.
- Produces durable schedule occurrences, explicit same-tenant recipients, protected-link notifications, and authorized markers on the existing app-wide calendar.

- [ ] Add red tests for weekly/monthly/quarterly previous-period selection, 29–31 clamp, IANA timezone/DST, Pro create/run checks, expiry pause/no backlog, concurrent idempotency, bounded retry, and explicit failure visibility.
- [ ] Add red tests for create/manage/trigger/view/download/recipient separation, revocation at run/notify/view/download, and unauthorized calendar suppression.
- [ ] Implement schedule lifecycle and protected-link in-app/optional email notifications; email must never attach report PDFs by default.
- [ ] Run focused SQL checks and schedule tests; distinguish local DB verification from production deployment, which remains an owner-controlled gate.

## Task 6: Integration, production/local reconciliation, and release gates

**Owner:** Sol only after all bounded packages return.

- [ ] Inspect each complete diff and surrounding call sites; verify no worker changed outside ownership.
- [ ] Reconcile the production screenshots with deployed build/revision, metric payload, and local fixture behavior before closing the mismatch.
- [ ] Run reporting tests, capability/report safety checks, SQL checks in a disposable local DB, migration drift, Babel/web export/type checks, and PDF raster/text structural checks.
- [ ] Run `git diff --check`; review accessibility, mobile web, authorization, partial failure, cache/version scope, and idempotency acceptance criteria.
- [ ] Update `docs/REPORTING_REMEDIATION_LEDGER.md` and implementation status with files, evidence, remaining risks, and verified/blocked states.
- [ ] Stage only intended implementation paths and plan/ledger updates; never stage all.

## Sequencing and gates

1. Task 1 must pass before any renderer or server package consumes the new model.
2. Task 2 must pass local SQL checks before Task 5 uses durable scheduling/storage.
3. Tasks 3 and 4 may proceed in parallel after Task 1; Task 4 owns all PDF primitives.
4. Task 5 follows Tasks 1–2 and integrates with the existing calendar/notification patterns.
5. Task 6 is mandatory and cannot be delegated. Production deployment is a separate owner-controlled gate.

## Plan self-review

- **Spec coverage:** audience profiles, HTML-first UX, independent PDF, screenshot defects, unavailable-vs-zero, production/local reconciliation, schedules, calendar markers, permissions, recipients, retry/idempotency, Pro expiry, quality gates, and open policy decisions are mapped to Tasks 1–6.
- **No placeholders:** no task relies on “TBD”, “later”, or unspecified edge-case handling; unresolved product/security decisions remain explicit in the approved spec and must be resolved before the affected package ships.
- **Interface consistency:** Tasks 2–5 consume the Task 1 snapshot/manifest contract; no package owns another package’s files; Task 6 owns cross-package integration.
- **Scope safety:** this plan does not authorize external sharing, production deployment, historical migration edits, or a DOM-to-PDF conversion.
- **Dirty worktree:** implementation must use explicit path staging and preserve all pre-existing changes.
