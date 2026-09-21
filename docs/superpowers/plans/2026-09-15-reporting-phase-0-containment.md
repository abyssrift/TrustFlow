# Reporting Phase 0 Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavior change. Sol owns integration and final PASS/BLOCK.

**Goal:** Stop known reporting data exposure, deterministic wrong-number paths,
orphaned native jobs, sensitive-parameter persistence, and unreproducible export
configuration without beginning the broader reporting rewrite.

**Architecture:** Preserve current public report surfaces while moving trust checks
to the database boundary, introducing small pure helpers for deterministic client
logic, and making unsupported/failing paths fail closed. This phase does not invent
new metric semantics or a durable worker.

**Tech stack:** PostgreSQL/Supabase migrations and rollback checks, Expo/React
Native/TypeScript, Vitest/static checks, `@react-pdf/renderer` as the unchanged
interim renderer.

## Global constraints

- Preserve every pre-existing dirty change and do not stage or commit user-owned hunks.
- Add a failing focused test/check before each production change and capture RED/GREEN evidence.
- Tenant and caller identity are server-derived; authorization and partial data fail closed.
- Do not change throughput/cohort, shared-team attribution, or salary-product semantics beyond the ledger's safe interim behavior without user direction.
- Desktop web, mobile web, and native entry points must be considered together.
- Update `docs/REPORTING_REMEDIATION_LEDGER.md` after Sol verifies each package.

---

### Task 1: Contain analytics RPC exposure

**Files:**
- Create: `supabase/checks/check_reporting_rpc_authorization.sql`
- Create: one timestamped migration after `20260915124000_report_capability_enforcement.sql`

**Interfaces:** Preserve existing RPC signatures used by clients. Remove anonymous
execution and enforce authenticated same-company/permission checks for organizational
audit, user summary, user series/company history, and stage dwell. Preserve the
existing working guards on personnel comparison and pipeline throughput.

- [x] Write a rollback SQL check with two tenants and anonymous, permissionless,
      same-company authorized, and foreign-company cases.
- [ ] Run it against the pre-migration local DB and record the expected exposure failure
      (not reproduced in this resumed session; local DB already contained earlier changes).
- [x] Add the migration, including explicit grants/revokes and overload cleanup.
- [x] Apply locally and rerun the check to green.
- [x] Inspect effective `pg_proc.proacl` and function count through the rollback check.

### Task 2: Reconcile report job and Storage contracts

**Files:**
- Create: `supabase/checks/check_reporting_job_storage_contract.sql`
- Create: one timestamped migration after Task 1

**Interfaces:** Canonical interim job fields are `error_log`, `started_at`, and
`completed_at`; requester owns readable jobs, while browser clients cannot overwrite
another requester's job. `reports` is private, server/requester paths are tenant
scoped, and Storage policies are explicit.

- [x] Write a rollback check proving canonical columns, legal constraints, private
      bucket, requester-owned lifecycle update, and cross-user/cross-tenant denial.
- [ ] Run RED against current local schema/config (not reproduced; the migration was
      applied before fixture-independent check execution).
- [x] Add idempotent schema/policy/bucket migration while preserving stronger live policies.
- [x] Run GREEN and migration drift inventory; GREEN passes, inventory records
      unresolved migration drift (see ledger Task 8).

### Task 3: Fix deterministic report calculations through pure helpers

**Files:**
- Create: `lib/reporting/reportCalculations.ts`
- Create: `lib/reporting/reportCalculations.test.ts`
- Modify: `components/intelligence/reports/ThroughputReport.tsx`
- Modify: `components/intelligence/reports/generate.ts`

**Interfaces:** `sortPeriodsChronologically`, `computeSuccessRateTrend`, and
`resolveScopedCompletedTasks` must be renderer-independent and preserve decimal
values until display.

- [x] Add failing tests for newest-first trend reversal and zero scoped completions.
- [x] Run focused RED (failed as expected: calculation module absent).
- [x] Implement minimal helpers and wire report/generator callers.
- [x] Run focused GREEN and report-related TypeScript audit (focused Vitest/Babel and isolated strict `tsc` pass; web export succeeds; full-project `tsc` baseline drift is unrelated and has no diagnostics in changed reporting paths).

### Task 4: Normalize and validate report calendar ranges

**Files:**
- Create: `lib/reporting/reportTimeframe.ts`
- Create: `lib/reporting/reportTimeframe.test.ts`
- Modify: desktop and adaptive report generators

**Interfaces:** User dates are inclusive calendar dates; output contains explicit
IANA timezone, `startInclusiveUtc`, and `endExclusiveUtc`. Reversed/invalid ranges
return a typed validation error before job creation.

- [x] Add RED cases for single day, Cairo/local boundary, month/year/leap day,
      invalid input, and reversed dates (initial missing-module RED recorded;
      final suite covers all listed boundaries plus DST and skipped dates).
- [x] Implement pure normalization and wire both generators; custom ranges retain
      local dates/timezone and carry inclusive legacy plus half-open UTC bounds.
- [x] Verify source contract: invalid custom dates return before expansion/job RPC;
      stage-dwell receives date-only bounds.

### Task 5: Fail closed on unsupported native generation and partial reads

**Files:**
- Modify: adaptive report entry/generator files without discarding existing capability changes
- Modify: `components/intelligence/reports/generate.ts`
- Add focused source/behavior tests beside the relevant implementation

- [x] Add RED checks proving native unsupported paths create no job and every required
      team query error aborts generation (RED observed for missing native guard;
      helper RED observed for missing module and malformed error/timestamp handling).
- [x] Disable native generation before request until the server worker exists.
- [x] Check every required team fetch error and reject malformed session durations.
- [x] Run focused GREEN on web/native resolution (source-contract checks, focused tests,
      Babel, isolated strict TypeScript, and web export pass).

### Task 6: Isolate analytics caches by authorization context

**Files:**
- Modify: `contexts/AnalyticsContext.tsx`
- Add: `contexts/AnalyticsContext.test.tsx` or a focused pure cache-key test module

- [x] Add RED for scope-key isolation across user/company/permission changes.
- [x] Namespace keys and clear cache/in-flight state on auth-context changes;
      reject stale completions before they can return or repopulate cache.
- [x] Run GREEN and existing analytics consumer integration checks (8 focused
      cache tests, source-contract check, Babel, and web export pass).

### Task 7: Separate report capabilities and redact sensitive request parameters

**Files:**
- Extend the Phase 0 capability migration/check rather than creating conflicting definitions
- Modify: desktop/adaptive report generators

- [x] Add RED proving `report.view` and `report.export` alone cannot generate.
- [x] Restrict generation to owner or `report.generate` plus active entitlement.
- [x] Add tests/checks proving salary values are absent from persisted job parameters
      and event payloads, including recursive/direct RPC parameter redaction.
- [x] Send redacted persisted parameters; suppress salary-based report inputs and
      durable cost output until an approved source/retention policy exists.
- [x] Run focused GREEN: 32 focused capability/redaction tests, combined 59/59
      reporting regression tests, source check, Babel, strict helper TS, web build,
      and local rollback SQL check pass.

### Task 8: Integrate and verify Phase 0

- [x] Rerun all three Phase 0 SQL checks in rollback mode against the local DB;
      all pass after applying the current Task 1, 2, and 7 migrations.
- [x] Run focused report tests, changed-file Babel, and strict TypeScript checks.
- [x] Run `npm run verify:agent` and classify failures (141/145 self-checks;
      three ProjectFilesTab Vitest failures; unrelated TS baseline mismatch;
      Windows wrapper path failure; web export passes).
- [x] Run `node supabase/checks/migration_drift.js` and record 19 repo migration
      files with missing local objects and 227 live objects not named in migrations.
- [x] Update the remediation ledger with files, commands, results, and remaining risks.
- [x] Sol reviewed the touched reporting/security paths; no Task 7-specific type
      diagnostics remain. Broad gate and production schema lineage remain open.

### Task 9: Correct Personal Pulse count and fail closed on report reads

- [x] Add focused coverage for valid zero/nonzero counts, missing/invalid counts,
      and count-query errors; source-contract checks cover generator plumbing.
- [x] Read the exact count from Supabase result metadata and validate it rather
      than turning unavailable count metadata into a plausible zero.
- [x] Make required label/project reads and signed URL creation fail the report
      before completion; correct the unbounded task-count label.
- [x] Verify focused Vitest (69), source-contract check, Babel, strict isolated
      helper TypeScript, web export, and `git diff --check`.
- [ ] Add mounted generator fault-injection tests for Supabase/storage failures;
      participant-row uniqueness semantics remain unverified.

### Task 10: Reconcile migration lineage (read-only gate)

- [x] Run the schema drift inventory and inspect local migration metadata without
      mutating local or production migration state.
- [ ] Reconcile from a frozen migration set on a fresh rehearsal DB with owner
      approval and backup before any production deployment; see
      `docs/PROD_MIGRATION_RECONCILIATION_2026-09-15.md`.

### Task 11: Disclose shared-team member overlap

- [x] Add RED/GREEN pure calculation tests for distinct shared members.
- [x] Deduplicate selected team IDs and carry membership overlap into report data.
- [x] Disclose in both two-team and N-team PDF layouts that overlapping members'
      activity is included in each team's metrics; preserve existing score logic.
- [x] Run focused tests, source-contract check, Babel, strict helper TypeScript,
      web export, and `git diff --check`.
- [ ] Resolve the long-term shared-work attribution semantics with the product
      owner; keep AN-022 decision-needed until then.

### Task 12: Verify terminal report-job transitions

- [x] Add RED/GREEN helper coverage for database errors and RLS-hidden zero-row results.
- [x] Require a returned job row before reporting generation success.
- [x] Surface failed-state persistence errors alongside the original generation error.
- [x] Verify focused helper tests, generator source contract, Babel, and strict helper TS.
- [x] Re-run web export after lifecycle integration.
- [ ] Add live RLS/network fault injection when a safe test harness is available.

### Task 13: Make two-team comparison ties neutral

- [x] Add RED/GREEN tests for all-tie and mixed decisive/tied category scoring.
- [x] Treat equal or invalid values as undecided and count only strict wins.
- [x] Preserve existing metrics, direction, and majority rule; no new ranking logic.
- [x] Verify focused tests, report safety contract, Babel, and strict helper TS.
- [ ] Run a representative generated-PDF visual check; local Poppler/pdfinfo tools
      are absent, so only Babel, helper tests, and web export were available.

### Task 14: Fail closed at the Team Comparison row cap

- [x] Add RED/GREEN tests for exact, empty, truncated, and missing-count results.
- [x] Request exact row counts and cap each Team Comparison read at configured
      `api.max_rows`; fail before report generation if response is incomplete.
- [x] Require every requested team ID to be visible in the caller-scoped lookup.
- [x] Keep member work-session totals even if the participant query returns no rows.
- [x] Verify focused regression suite (78), Babel, strict helper TypeScript, and web build.
- [ ] Replace client-side raw-row aggregation with a server-side bounded aggregate
      in the architecture/performance phases.

### Task 15: Exclude removed members from active team comparisons

- [x] Add a source-level regression guard and observe it fail before the filter.
- [x] Filter team membership to `removed_at IS NULL` before deriving team members,
      overlap counts, tasks, and hours.
- [x] Run the full focused reporting suite (79), Babel, strict helper TS, and serial web export.

### Task 16: Represent N-team point-ranking ties accurately

- [x] Add RED tests for tied maximum scores and all-zero scores.
- [x] Compute true point maximum and all tied leaders; remove the arbitrary 1-point floor.
- [x] Present plural tied-leader copy and highlight every team at the maximum.
- [x] Run focused regression suite (44 reporting tests), report source contract, strict helper TS, Babel,
      web export, and `git diff --check`.
- [x] Render tied-leader and all-zero reports to PDF buffers with React PDF; assert
      valid PDF headers and non-empty output.
- [x] Full verification rerun classified known non-reporting failures; no reporting
      diagnostic remains after correcting the PDF test's `Document` wrapper.
- [ ] Perform page-level visual/text inspection when a PDF inspection utility is available.

### Task 18: Preserve undefined team success rates

- [x] Add RED/GREEN helper cases for zero denominator, observed zero success,
      negative/missing counts, null comparisons, and denominator-aware averages.
- [x] Display no-outcome team rates as unavailable, exclude those teams from the
      unweighted average, and show N/A when the group has no observed outcomes.
- [x] Verify focused calculations/PDF tests (49), report safety source contract,
      strict helper TypeScript, Babel, web export, and `git diff --check`.

### Task 19: Preserve missing Personnel metrics

- [x] Add nullable finite-observation average helper tests.
- [x] Display missing Personnel rates as unavailable, exclude from averages,
      and keep available averages unweighted.
- [x] Add PDF render smoke case for mixed observed/missing values.
- [x] Verify reporting tests (51), safety source contract, strict helper TypeScript,
      Babel, web export, and `git diff --check`.

- [ ] Verify upstream RPC semantics for nullable Personnel rates against a seeded
      database fixture; visually inspect PDF when a renderer tool is available.

### Task 20: Represent Personnel ranking ties accurately

- [x] Add tied and all-zero Personnel PDF render regression case and source guard.
- [x] Reuse tie-aware ranking helper; highlight all true maxima and use plural,
      neutral copy for tied people.
- [x] Verify focused reporting/PDF tests (52), safety contract, strict helper TypeScript,
      Babel, web export, and `git diff --check`.

### Task 21: Preserve the empty Targets hit-rate denominator

- [x] Add helper cases for 0/0, invalid counts, and a valid 1/2 ratio.
- [x] Show N/A when there are no targets; retain hit/all-targets formula otherwise.
- [x] Add empty Targets PDF render smoke case and source-contract guard.
- [x] Verify reporting/PDF tests (54), source contract, strict helper TypeScript, Babel,
      web export, and `git diff --check`.

### Task 22: Neutralize Worker head-to-head ties

- [x] Add source guard and PDF smoke fixture with identical workers.
- [x] Treat equal/invalid metrics as undecided and tally only strict wins.
- [x] Verify reporting/PDF tests (55), source contract, strict helper TypeScript,
      Babel, web export, and `git diff --check`.

### Task 23: Align N-person Worker Comparison ranking and null semantics

- [x] Reuse tied-leader and observed-average helpers in N-person layout.
- [x] Display null rates neutrally and avoid counting them in averages.
- [x] Add grouped PDF regression case for tied-zero leaders and null rates.
- [x] Verify reporting/PDF tests (56), source contract, strict helper TypeScript,
      Babel, web export, and `git diff --check`.

### Task 24: Sample-weight the Stage Dwell overall average

- [x] Add RED/GREEN helper coverage for unequal sample counts and zero samples.
- [x] Weight stage means by `sample_count` and display N/A/em dashes for no data.
- [x] Add PDF smoke fixture with imbalanced stage counts and an unused stage.
- [x] Verify reporting/PDF tests (58), source contract, strict helper TypeScript,
      Babel, web export, and `git diff --check`.

### Task 25: Preserve unavailable User Summary rates

- [x] Preserve observed finite timer-efficiency/on-time rates and distinguish
      missing/non-finite rates from measured zero.
- [x] Avoid threshold copy/colors and success-rate derivation from unavailable
      data; keep no-outcome task success rate unavailable.
- [x] Add a generated-PDF smoke case for missing rates and zero outcomes.
- [x] Verify focused reporting/PDF suite (6 files/10 tests), source safety
      contract, and Babel parsing for changed report/test/check files.
- [ ] Verify historical RPC null semantics and inspect extracted PDF text/layout
      when the source definition and a PDF inspection utility are available.

### Task 26: Neutralize zero-to-zero General Report comparison label

- [x] Add focused pure formatter coverage for zero/zero and preserve
      zero-to-positive plus nonzero-prior percentage cases.
- [x] Replace false `NEW` output for zero in both periods with the literal
      neutral note `0 in both periods`; preserve all other existing comparisons.
- [x] Verify report suite (7 files/13 tests), report safety source check, Babel,
      `git diff --check`, web export, and graph refresh.
- [ ] Reconcile no-observation zero semantics if/when the organizational audit
      RPC exposes denominators; full-project typecheck remains baseline-red.

### Task 27: Rank General Report productivity by tasks per hour

- [x] Add adversarial ranking tests where worker-time order differs from
      tasks/hour order, including an omitted-from-top-eight fast worker and ties.
- [x] Build a stable productivity ranking from finite positive-hour observations;
      use it for the chart and top-performer insight while leaving People Detail
      order untouched.
- [x] Ensure missing/zero/non-finite hours cannot create a false ranked rate;
      disclose tied top performers without choosing one arbitrarily.
- [x] Verify focused General Report tests, reporting suite, safety source check,
      Babel, TypeScript diagnostics for changed files, web export, graph refresh,
      and `git diff --check`.

### Task 28: Preserve undefined organizational-audit metrics

- [x] Inspect active private RPC signature/body and catalog security contract;
      preserve wrapper, owner/security mode, fixed search path, ACLs, and scope.
- [x] Add a forward-only migration and rollback fixture for NULL-vs-observed-zero,
      output keys, authorization, tenant isolation, and wrapper/private ACL shape.
- [x] Adapt General Report KPI formatting/colors, comparison notes, and insights:
      undefined is N/A/neutral; observed zero remains zero; preserve the Rework
      ratio explanation; keep throughput counts semantically distinct from rates.
- [x] Search all callers of the organizational-audit RPC and make desktop and
      adaptive trend cards preserve unavailable current/prior values as N/A/no
      delta rather than coercing them to zero.
- [x] Add UI/helper regression tests; focused tests 20/20 and combined report/
      helper suite 30/30 across 8 files; safety check, Babel, web export, and
      `git diff --check` pass. Full-project `npx tsc --noEmit` exits 2 on
      repository diagnostics; the filtered output has one unrelated existing
      nullable `conversion_by_stage` error at `RadarWidgets.tsx:236`, with no
      errors in the changed trend-card block, GeneralReport, or analytics helper.
- [ ] Refresh graph after broader trend-card edits. Latest refresh reached 100%
      AST extraction but graph generation stalled without completion output and
      was interrupted; no refreshed artifact is claimed.
- [x] Execute candidate migration + rollback fixture on the healthy local
      `supabase_db_TrustFlow` inside one outer transaction. All SQL assertions
      passed, including null-vs-zero, stable output keys, auth/tenant boundaries,
      and wrapper/private owner/security/search_path/ACL properties. The fixture's
      final rollback also undid the temporary function replacement; no migration
      history or persistent fixture changes were written. Its nested `BEGIN`
      emitted the expected already-in-transaction warning.
- [ ] Keep production application blocked on owner-controlled migration
      reconciliation, rehearsal, backup, and release approval.

### Task 29: Exercise authenticated analytics-cache transitions in a mounted provider

- [ ] Add a provider-level test using the existing `react-test-renderer` pattern;
      mock `useAuth` with two users/companies and mock the organizational-audit
      RPC with deferred promises.
- [ ] Prove a settled response cached for principal A is not returned to
      principal B for the same logical request.
- [ ] Prove an A-scoped request still in flight when auth scope changes cannot
      populate/resolve into B's scope; B starts/receives its own response, and
      subsequent B requests reuse only B's result.
- [ ] Keep production code unchanged unless the test reproduces a failure; if it
      does, stop and return the minimal failing evidence to Sol before expanding
      the worker's file scope.
- [ ] Run focused provider/helper tests, context safety check, Babel, web export,
      and `git diff --check`; record any repository-wide typecheck baseline.
- [ ] Preserve unresolved exact mapping of SEC-006..SEC-010 until the original
      council findings are available; this task verifies the already documented
      cache-isolation residual without guessing a child ID.
