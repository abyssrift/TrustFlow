# Analytics Trust and Overview Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Intelligence Hub's analytics trustworthy and easier to scan by separating Overview, Performance, and Targets, using typed metric definitions and canonical target data, and omitting plan-restricted sections only after billing entitlements load.

**Architecture:** Treat the `rpc_get_organizational_audit` response as a typed `OrganizationalAudit` contract and define displayable metrics once in a metadata registry. Use one canonical target hook for both the Overview's bounded Target Watch and the dedicated Targets view; keep Overview focused on one summary of successful completions, at most one trustworthy outcome ring, and no more than two supporting KPI rows/cards. Keep database authorization authoritative and independent from client entitlement-based presentation.

**Tech Stack:** Expo Router, React Native/React Native Web, TypeScript, Supabase RPCs and SQL migrations, existing `useBillingPlan`, `useAuth`, and Intelligence Hub desktop/adaptive components.

## Global Constraints

- Keep server-side permission checks and row-level access predicates authoritative; analytics readers require `analytics.view`, while target readers require the separate `target.view` capability. Client permission checks control presentation only.
- Hide a plan-restricted section only after `useBillingPlan().ready` is true; while billing is unresolved, show a loading state and do not imply the account lacks access.
- Preserve null, unavailable, and zero as distinct states. Do not coerce missing metric values to `0` or show a metric whose source does not support its stated meaning.
- Overview contains exactly one summary of successful completions, at most one trustworthy outcome ring, and at most 1â€“2 supporting KPI rows/cards. Detailed analysis belongs in Performance; goal definitions and progress belong in Targets.
- Use plain, literal labels on Overview. Prefer words such as “At a glance,” “Completed successfully,” and “Success rate”; keep implementation or analytics jargon out of headings and helper copy.
- Supported additions: on-time rate, corrected rework, and lead-time percentiles. True flow efficiency remains blocked until stages have dependable classification; automation metrics remain blocked until events have dependable automation attribution.
- Provide equivalent outcomes on desktop web, adaptive/tablet web, and mobile web. Follow `.agents/rules/ui-consistency.md`, `.agents/rules/ux-consistency.md`, `.agents/rules/ui-style-guide.md`, and `.agents/rules/walkthroughs.md`.
- Do not add or run tests during this planning turn. Implementers must add/run the focused checks listed in the relevant tasks before declaring implementation complete.

## Worktree Cautions

The worktree was already heavily dirty when this plan was written. Do not reset, clean, or restore the repository wholesale. Before editing any path below, inspect its current diff and preserve existing work. Analytics/reporting-adjacent dirty paths include `contexts/AnalyticsContext.tsx`, `components/intelligence/_index_adaptive.tsx`, `components/intelligence/_ReportGenerator_adaptive.tsx`, `components/intelligence/_ReportGenerator_desktop.tsx`, `components/intelligence/_archives_adaptive.tsx`, `components/intelligence/_archives_desktop.tsx`, `components/intelligence/_filehub_adaptive.tsx`, `components/intelligence/_filehub_desktop.tsx`, `components/intelligence/_reports_adaptive.tsx`, `components/intelligence/_reports_desktop.tsx`, multiple files under `components/intelligence/reports/`, `hooks/useBillingPlan.ts`, and the untracked `lib/reporting/` directory. Related new reporting checks/migrations and `docs/REPORTING_REMEDIATION_LEDGER.md` are also present. `.agents/rules/global-utilities-index.md` is dirty and must not be reverted as cleanup. These changes may already touch data contracts, entitlements, or reporting semantics; reconcile them before integrating this work.

---

## Phase 0 â€” Truth cleanup and metric inventory

**Started 2026-09-20:** the first UI-only cleanup removed the fake Group Pulse radar, removed Flow Ratio and Automation Score from Overview choices, restored global desktop scope by default, replaced the fixed 2.5-day â€œtargetâ€ claim with literal threshold copy, omitted restricted widget placeholders, and preserved numeric zero separately from missing percentage values. The metric contract inventory, server definitions, focused checks, and browser walkthrough remain open.

**Files:**
- Modify: `components/intelligence/_index_desktop.tsx`
- Modify: `components/intelligence/_index_adaptive.tsx`
- Modify: `components/intelligence/IntelligenceSections.tsx`
- Modify: `components/intelligence/RadarWidgets.tsx`
- Modify: `contexts/AnalyticsContext.tsx`
- Inspect: the existing `rpc_get_organizational_audit` migration and its `supabase/checks/` coverage before choosing the migration to update.

**Depends on:** None. This phase establishes the data truth that later UI phases consume.

- [ ] Inventory every Overview metric from its label through its SQL/RPC source. Record the numerator, denominator, time window, null/empty behavior, row-level access filter, and plan limit for each.
- [ ] Remove misleading aliases and unsupported display entries, including â€œAutomation Scoreâ€/`automation_offload` unless the server can attribute the measured events to automation.
- [ ] Replace `value || 0` display fallbacks for observed analytics with explicit unavailable/empty rendering; retain `0` only when the source returned a measured zero.
- [ ] Correct the first-pass label/definition so it describes first-pass integrity as 100% minus the defined corrected rework rate, with its denominator and sample window documented in the UI.
- [ ] Add or update focused pure/data-contract checks for zero, null, empty cohorts, and permission-filtered rows. Do not change server authorization behavior.

**Acceptance:** Every remaining visible metric has a documented and traceable source and reports â€œunavailableâ€ or an empty state when the source cannot support a value. No unsupported automation or flow-efficiency claim appears as a numeric KPI.

## Phase 1 â€” Typed audit contract and metric registry

**Files:**
- Create: `lib/analyticsMetrics.ts`
- Modify: `contexts/AnalyticsContext.tsx`
- Modify: `components/intelligence/_index_desktop.tsx`
- Modify: `components/intelligence/_index_adaptive.tsx`
- Create: `lib/analyticsMetrics.test.ts`

**Interfaces:**
- Produce a shared `OrganizationalAudit` TypeScript type that describes the response of `rpc_get_organizational_audit`, including current/comparison values, radar metrics, availability, and optional newly supported metrics.
- Produce a metric registry keyed by stable metric keys. Each entry defines its user-facing label, unit/format, source field, aggregation meaning, availability rule, and optional plan feature key. Consumers must render registry-backed metrics rather than maintain private label/source mappings.

- [x] Define the exact response type from the live SQL return shape; represent values that can be absent as nullable/optional instead of coercing them to zero.
- [x] Define registry entries for only the metrics accepted in Phase 0. Exclude blocked/rejected metrics from renderable entries.
- [ ] Add registry entries for the supported Phase 2 metrics only after their server fields and empty-sample semantics exist.
- [x] Type the analytics fetch/context surface against `OrganizationalAudit` and remove `any` at the Overview boundary where it consumes that response.
- [x] Migrate the desktop Performance audit reader and conversion funnel boundary to the shared typed contract; source the desktop throughput success-rate label from the metric registry.
- [x] Add unit checks that every registry entry points to a valid contract field, has a valid format/availability definition, and has a unique key.
- [ ] Run the focused metric registry test and the repository's applicable secret-free validation gate during implementation.

**Acceptance:** Overview and Performance read one shared contract and metric registry; adding a supported metric does not require a new competing label/source map in each screen.

**Phase 1 progress (2026-09-20):** The exact audit response contract, supported metric registry, scoped cached reader, and desktop/adaptive Overview migration are complete. Desktop Performance now uses the shared cached audit reader, and its conversion funnel boundary is typed against the canonical contract. The focused metric contract test now passes; the broader validation gate and runtime checks remain open. The audit empty-sample fallback is addressed by the Phase 2 migration below; `OrganizationalAudit` already types these values as nullable, and the existing Overview formatter renders unavailable values as an em dash.

## Phase 2 â€” Canonical targets and supported metric sources

**Files:**
- Create: `hooks/useCanonicalAnalyticsTargets.ts`
- Modify: `contexts/AnalyticsContext.tsx`
- Create: `supabase/migrations/20260921063116_analytics_audit_empty_sample_semantics.sql` (created via `supabase migration new`).
- Create: `supabase/migrations/20260921090040_canonical_analytics_targets.sql` for the canonical target reader (deployed to the confirmed TrustFlow project as remote migration version `20260921103303`; local source filename retained).
- Create: `supabase/checks/check_canonical_analytics_targets.sql` for the canonical reader ACL, tenant/access, null/zero, reversal, and performance contract.
- Create a later migration for the remaining supported metric sources only when their exact data definitions are accepted.
- Create or update: `supabase/checks/check_analytics_trust_overview_metrics.sql`
- Modify: `lib/analyticsMetrics.ts`
- Create: `hooks/useCanonicalAnalyticsTargets.test.ts`

**Interfaces:**
- `useCanonicalAnalyticsTargets()` returns `{ targets, loading, error, refresh }` from the canonical target-status reader and maps server rows once into a typed `CanonicalAnalyticsTarget` model. Overview and Targets must use this hook/model and must not independently derive target status/progress from different RPCs.
- Extend `OrganizationalAudit` only for server-returned fields with an explicit SQL definition.

**Canonical target decision (2026-09-21):** Volume progress is the gross count of non-reversal entries into the target stage from `target.created_at` through the earlier of its deadline or now. A later undo does not erase the original entry; the reversal event itself does not count. When the nullable `target.created_at` boundary is absent, `observed_value` and `progress_unit` are null rather than a false measured zero. The reader returns the stored `active`/`completed`/`expired` lifecycle status separately and does not invent a second computed status. Performance targets return their stored active-time and lifecycle-time SLA budgets, with `observed_value` and percent progress left null until an authoritative observed-performance definition and data source exist. The new reader requires an authenticated caller company and `target.view`, uses a fixed `search_path`, limits rows to the caller company, and applies task and project access helpers to every counted event. A read-only live-schema reconciliation confirmed the referenced target/history columns, nullable `created_at` and `is_reversal`, int4 quantity/budget fields, and company RLS shape. The migration is deployed and its rollback-only SQL access/result check passes; installed function security and ACL were inspected.

The canonical hook, Overview Target Watch, and dedicated desktop/adaptive Targets screens now consume this reader. A pure compatibility adapter supplies the existing card/modal shape without reintroducing local progress calculations. Target writes remain direct table mutations and refresh the canonical reader only after success. The deployed reader has passed its SQL self-check and installed ACL/config inspection.

**Dedicated Targets adapter package:** Keep target writes on their existing table mutations, but replace both screen read paths with `useCanonicalAnalyticsTargets()`. Add one pure compatibility adapter that supplies the current card/modal shape from the canonical model; use `observedValue` only for volume counts and `storedStatus` for active/history grouping. Performance cards must show their stored SLA budgets without a percentage ring or the current fixed 50% placeholder. Preserve the existing `target.view` guards and pipeline/stage option queries. After each successful create, update, status, or delete mutation, await the hook's `refresh()`; a failed mutation must not refresh into an apparent success. Render reader failures as unavailable rather than zero. Implementation ownership should remain disjoint: one worker owns the adapter and its focused check, one owns desktop Targets, one owns adaptive Targets, then Sol integrates. The canonical migration is deployed and its runtime reader is available to the migrated client.

**Audit empty-sample semantics (2026-09-21):** The migration changes only `current.success_rate`, `current.avg_lead_time_minutes`, `current.revision_rate`, `comparison.success_rate`, `comparison.avg_lead_time_minutes`, `comparison.revision_rate`, and `radar_advanced.first_pass_yield`: empty samples now return null, while measured zero with an eligible sample remains zero. It also returns `current.sample_size` as the count of filtered `base_tasks`; the client types this field as optional so an older server payload hides the outcome ring instead of guessing whether a zero is measured. The nullable `OrganizationalAudit` fields and Overview em-dash formatting support this behavior. The migration has not been applied or database-verified; SQL-check and test boxes remain unchecked.

- [x] Confirm and document canonical volume/performance semantics; author the hardened reader and typed hook without changing target-write RPCs.
- [x] Migrate the dedicated desktop/adaptive Targets reads to the canonical hook through a compatibility adapter, and refresh the canonical reader after successful target mutations.
- [ ] Implement on-time rate with an explicit completed-task denominator and due-date rule; return null when there are no eligible completed tasks.
- [ ] Implement corrected rework using the repository's revision/correction events and distinguish corrected work from ordinary edits. Define whether the measure counts corrected items or correction events, then use that definition consistently in SQL, contract, registry, and label.
- [ ] Implement lead-time percentiles from a defined start event to a defined completion event. Return named percentile fields (including the percentile level and unit) and null when the sample is empty; do not substitute an average or stage dwell time.
- [x] Author rollback-only canonical target SQL checks for exact ACL, unauthenticated/permission denial, hand-calculated visible entries, reversal exclusion, task/project access, null versus measured zero, cross-company isolation, stored status, and performance thresholds.
- [x] Apply the canonical reader migration to the confirmed TrustFlow project (remote version `20260921103303`), run `supabase/checks/check_canonical_analytics_targets.sql`, and inspect the installed function ACL/config before releasing the dependent client. The first self-check attempt failed because its fixtures violated `idx_active_target_per_stage`; the transaction rolled back with zero fixture-company leftovers. After assigning distinct stages to simultaneous active targets, the check passed and rolled back. Live inspection confirmed `SECURITY DEFINER`, `search_path=public`, and EXECUTE granted to `authenticated` only (`anon`, `service_role`, and `PUBLIC` false); cleanup found zero fixture companies.
- [x] Add focused hook checks for initial loading, disabled/no-query, empty success, and RPC error behavior; keep canonical target field mapping covered by the pure adapter checks.

**Acceptance:** On-time rate, corrected rework, and lead-time percentiles are computable from explicit server definitions. Overview and Targets agree on target identity/status/progress. SQL checks prove correct scope and authorization. Do not add true flow-efficiency or automation metrics: stage classification and automation attribution remain absent prerequisites.

## Phase 3 â€” Overview at a glance and bounded Target Watch

**Files:**
- Modify: `components/intelligence/_index_desktop.tsx`
- Modify: `components/intelligence/_index_adaptive.tsx`
- Modify: `components/intelligence/IntelligenceSections.tsx` as needed to share presentation without moving screen ownership into a generic dashboard component.
- Modify: `lib/analyticsMetrics.ts` only when the new Overview metric selection needs an explicit registry grouping.

- [x] Replace the configurable KPI/widget wall on Overview with one summary of successful completions whose time range and pipeline scope match the returned audit data.
- [x] Render one Success rate ring only when the audit supplies `current.sample_size > 0` and a finite rate; show the denominator beside it. Keep First-Pass Integrity out of the ring until its denominator is limited to eligible completed work rather than all created tasks.
- [x] Keep this slice to the summary of successful completions and one outcome ring; no supporting KPI row/card is added. Future supporting metrics remain bounded to two and require supported registry fields.
- [x] Add a separate, compact Target Watch summary using `useCanonicalAnalyticsTargets()`. Show up to three active volume targets with literal counts and a link to Targets; omit performance progress until an observed SLA source exists.
- [x] Keep filters, date-range limits, and pipeline scope aligned between the at-a-glance summary and its source audit response.
- [ ] Preserve permission-denial and server-error states as unavailable/access states; never turn either into plausible zero values.

**Acceptance:** Overview answers â€œwhat is happening now?â€ at a glance and contains exactly one hero, zero or one outcome ring, and at most two supporting KPI rows/cards. Target Watch uses the canonical model and links to full Targets management. No widget customization can exceed these bounds.

**Phase 3 progress (2026-09-21):** Desktop and adaptive Overview now share `AtAGlance`: a Completed successfully total plus an optional Success rate ring with plain labels. The ring includes the filtered task sample count, preserves a valid measured 0%, and stays hidden against older RPC payloads until the audit empty-sample migration supplies `current.sample_size`; that migration remains unapplied. Configurable KPI tiles and their saved widget preferences were removed. A separate Target Watch now uses the canonical hook, is omitted without `target.view`, and shows up to three active volume targets with loading, unavailable, and empty states kept distinct. Its canonical reader migration is deployed and SQL-verified. The existing audit fetch path still needs an explicit server-error state so a failed refresh cannot leave prior-scope data looking current. Runtime, visual-width, and browser verification remain open.

**Canonical Targets client progress (2026-09-21):** Desktop and adaptive Targets now share the canonical reader through `toTargetScreenTarget`. Volume cards use the server-observed entry count, preserve a measured zero, and show unavailable when either count or a positive denominator is absent. Performance cards no longer render the fixed 50% progress claim; they show only stored active and lifecycle SLA budgets. Successful create, update, status, and delete mutations refresh the canonical reader. The focused adapter test initially passed (3 tests), and targeted Babel checks passed for both screens. The reader is now deployed and SQL-verified; subsequent focused client validation passes 18/18 tests.

**Canonical Targets focused validation (2026-09-21):** The initial adapter/hook run passed 7 tests across 2 files. The hook now starts in loading state when enabled, so Overview and Targets do not briefly render an empty state before the first RPC begins. The nullable-window follow-up expanded coverage to 11 tests; the later focused client suite passes 18/18. These client checks are separate from the SQL self-check and do not establish browser/native rendering.

**Nullable target window follow-up (2026-09-21):** The hook and adapter now preserve nullable `created_at`; the reader reports unavailable volume progress when that boundary is absent. Desktop bounded history filters omit undated rows, ALL history labels them `Date unavailable`, and desktop charts plus adaptive velocity omit invalid/undated points. The expanded focused hook/adapter run passed 11 tests across 2 files; targeted Babel passed for the hook, adapter, and both Targets screens. The canonical SQL self-check has since passed and rolled back.

## Phase 4 â€” Overview / Performance / Targets information architecture and entitlement behavior

**Files:**
- Modify: `components/intelligence/_index_adaptive.tsx`
- Modify: `components/intelligence/_index_desktop.tsx`
- Modify: `components/intelligence/_analytics_adaptive.tsx`
- Modify: `components/intelligence/_analytics_desktop.tsx`
- Modify: `components/intelligence/_targets_adaptive.tsx`
- Modify: `components/intelligence/_targets_desktop.tsx`
- Modify: `components/intelligence/_targets_web.tsx`
- Create: `supabase/migrations/20260921074104_analytics_bucketed_range_tenant_scope.sql`
- Inspect: `app/(tabs)/intelligence/analytics.tsx` to confirm native/web route parity; modify only if the section selection is route-owned.
- Inspect: `hooks/useBillingPlan.ts`; its existing `ready` contract is the required entitlement loading boundary. Do not weaken its fail-closed behavior.

- [ ] Set the Intelligence Hub information architecture to **Overview**, **Performance**, and **Targets**. Overview is the operational summary, Performance owns time-series/comparative/detail analysis, and Targets owns goal definition, progress, completion, and editing.
- [x] Keep Archives available in its existing capability-gated destination; do not merge archive browsing into analytics metrics.
- [x] Move remaining detailed analytics widgets and comparisons to Performance; remove duplicate Overview summaries from that screen.
  - [x] Remove the desktop Overview mini charts for throughput, pipeline points, SLA risk, stage duration, funnel, and period trends after confirming their full views already exist on Performance or Analytics.
  - [x] Remove adaptive Overview SLA risk, work distribution, quality, and period trends after confirming equivalent adaptive Performance views.
  - [x] Add adaptive Performance coverage for Pipeline Load and Funnel, then remove those two remaining adaptive Overview details.
- [x] Render a plan-restricted section only when billing `ready` is true and the relevant feature is available. Omit the entire section and its layout wrapper when the feature is unavailable or entitlement is unresolved; keep page-level billing errors distinct from an upgrade prompt.
  - [x] Omit the desktop Reports navigation row unless billing is ready and Reports is enabled; do not show the plan badge before billing is ready.
  - [x] Omit the Personnel CSV export control when the resolved plan does not include `personnelExport`; do not render an upgrade badge, lock row, or empty control wrapper.
  - [x] Add distinct billing loading/error states to desktop Overview and desktop/adaptive Performance before using plan labels or date limits.
- [ ] Keep the `analytics.view` permission check separate from plan entitlement: the client uses permission for navigation/presentation, while each protected server reader continues to enforce the permission and per-row access itself.
  - [x] Guard direct Performance routes with `analytics.view` and direct Targets routes with their existing `target.view` contract; delay their data-owning components until permissions resolve.
  - [x] Author a tenant-scope migration for bucketed throughput and points range RPCs that rejects unauthenticated, unauthorized, foreign-company, deleted, and missing pipelines before delegating to the unchanged metric queries.
  - [ ] Apply the migration and run SQL regression checks proving both RPCs allow a same-company live pipeline, reject anon and callers without `analytics.view`, raise `42501` for foreign-company/deleted/missing pipelines, and deny direct execution of both private delegates.
- [x] Preserve query parameters/deep links or update them consistently when section names/routes change. Adaptive legacy `?section=analytics` and `?section=targets` now replace to their destinations; only `radar` and permission-allowed `archives` remain local, with unknown or unauthorized values returning to Overview.

**Acceptance:** Navigation presents the three distinct analytics destinations. Restricted sections never flash a false lock state or leave empty layout cells while entitlement resolves. Client navigation does not grant server access.

**Phase 4 density progress (2026-09-21):** Desktop and adaptive Overview now contain `AtAGlance`, the permission-gated Target Watch, and the actionable current-work `ProjectLens`. Desktop detailed mini charts remain available in their existing Performance or Analytics destinations. Adaptive SLA risk, work distribution, quality, and period trends remain on Performance; Pipeline Load and Funnel now use the shared native-safe `AdaptivePipelineDetails` presentation in adaptive Performance, so their Overview copies were removed. Target-screen reads are consolidated through the canonical adapter. The audit RPC uses a lookback ending today, so Pipeline Load and Funnel do not yet represent an arbitrary historical `to` date selected in Performance. Runtime and responsive visual verification remain open.

**Phase 4 remaining audit (2026-09-21):** Archives remains a separate permission-gated destination and its server readers retain principal/company scope. The desktop Intelligence sidebar now omits Reports until billing is resolved and entitled. Desktop Overview and desktop/adaptive Performance now keep permission loading/denial distinct from billing loading/error and resolved plan access. Direct Performance routes require `analytics.view`; direct Targets routes preserve the separate `target.view` contract, and neither mounts its data-owning content before permission resolution. Adaptive legacy `?section=analytics` and `?section=targets` now replace to their routes; `radar` and permission-allowed `archives` remain local, while unknown or unauthorized section values fall back to Overview. Phase 4 remains open because `20260921074104_analytics_bucketed_range_tenant_scope.sql` is unapplied and its required SQL regression run remains outstanding. The canonical reader migration is deployed and its SQL check and installed ACL/config inspection passed.

## Phase 5 â€” Responsive parity, regression checks, and manual walkthrough

**Files:**
- Verify: desktop/adaptive files listed in Phases 3â€“4.
- Verify: `lib/analyticsMetrics.test.ts`, `lib/analyticsTargets.test.ts`, `hooks/useCanonicalAnalyticsTargets.test.ts`, `supabase/checks/check_analytics_trust_overview_metrics.sql`, and `supabase/checks/check_canonical_analytics_targets.sql`.
- Update: `docs/analytics-ui-connections.md` with the final source-to-screen map if it is the maintained analytics UI reference.

- [ ] Verify at **~1400px** that Overview uses desktop space effectively, Performance detail remains readable, Targets remains a distinct destination, and no card/table is clipped.
- [ ] Verify at **~1000px** that the adaptive/web switch does not lose controls or create a narrow desktop-only layout; confirm chart sizing and scroll ownership.
- [ ] Verify at **390px** that the same key decisions and actions are available with touch-sized controls, no horizontal page overflow, no compressed chart legend, and a usable Target Watch-to-Targets path.
- [ ] Manually walk through analytics allowed/denied, billing loading/restricted/entitled, empty data, all-zero data, selected pipeline/date range, and populated data. Confirm server denial never appears as zero and targets match on Overview and Targets.
- [ ] Run `npx vitest run lib/analyticsMetrics.test.ts lib/analyticsTargets.test.ts hooks/useCanonicalAnalyticsTargets.test.ts`, then `npm run verify:agent`, `node scripts/babelcheck.mjs components/intelligence/_index_desktop.tsx components/intelligence/_index_adaptive.tsx components/intelligence/_analytics_desktop.tsx components/intelligence/_analytics_adaptive.tsx components/intelligence/_targets_desktop.tsx components/intelligence/_targets_adaptive.tsx components/intelligence/_targets_web.tsx`, and both analytics SQL self-checks. Record any browser/manual gap plainly; TypeScript or source inspection alone is not desktop/mobile visual verification.

**Acceptance:** The core flows work at ~1400px, ~1000px, and 390px; Overview, Performance, and Targets have clear separate responsibilities; entitlement and authorization states are not conflated; and validation reports no new relevant diagnostics or SQL-check failures.

**Phase 5 verification attempt (2026-09-21):** The earlier exact targeted Babel command passed for all seven listed Intelligence files. At that point the focused Vitest command could not run because planned test files were absent; subsequent focused client suites pass 18/18. `npm run verify:agent` failed: 147/152 self-checks passed, three existing `ProjectFilesTab` tests failed, TypeScript diagnostics drifted from the recorded baseline, the gate's Windows Babel launcher resolved `C:\Program` incorrectly, and local Supabase lint reported existing schema errors; the web export portion succeeded. The audit empty-sample SQL check remains outstanding. The canonical target SQL self-check now passes and rolls back, and its reader migration is deployed. The bucketed-range migration remains unapplied. Browser inspection showed Overview, Performance, and Targets rendering without obvious clipping at the available large-desktop viewport and at a confirmed 1000 CSS-pixel viewport with no page-level horizontal overflow. The earlier adaptive zero-data Throughput bars incorrectly rendered as fully failed despite showing 0 completed and 0 failed; a focused follow-up fixed the track widths, but the broad/manual empty/all-zero walkthrough remains unchecked. The 390 CSS-pixel attempt reached a blank document while Metro navigation was hanging, so mobile verification remains blocked. No Phase 5 checkbox is complete from this partial run.

**Phase 5 focused regression follow-up (2026-09-21):** `npx vitest run lib/throughputPresentation.test.ts` first failed as expected because `./throughputPresentation` did not exist; after adding the helper and applying its widths to adaptive Performance, the same command passed (2 tests). This fixes the zero-outcome track widths but does not complete any Phase 5 checkbox or close the pending broader verification.

**Phase 1 metric contract follow-up (2026-09-21):** `npx vitest run lib/analyticsMetrics.test.ts` failed first on the missing efficiency sample-size registry field and reader, then passed (5 tests) after adding `sampleSizeField: 'current.sample_size'` and the registry-backed optional sample-size reader. The checks cover registry key/source/display contracts, zero/null/non-finite values, and formatting. The Phase 5 combined focused-and-broad command remains unverified; this targeted run does not complete a Phase 5 checkbox. The current focused client suites pass 18/18, and scoped Babel/diff checks pass; this does not imply the combined broad command passed.

## Explicitly Deferred Metrics

- **True flow efficiency:** defer until every relevant pipeline stage has a stable, explicit classification that distinguishes value-adding work from waiting. Do not infer it from stage duration or completion rate.
- **Automation rate/score:** defer until automation-originated actions have reliable source attribution. Do not infer attribution from task status or user activity.

If either prerequisite is missing at implementation time, keep that metric absent and report the missing source contract instead of inventing a proxy.
