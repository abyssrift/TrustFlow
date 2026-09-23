# TrustFlow Reporting Remediation Ledger

This file is the durable execution index for the canonical ledger and Imagined
Reporting System approved in the 2026-09-15 audit conversation. Stable IDs are
never deleted. A remediation changes `Status`, appends files and evidence, and
retains remaining risk.

Status values: `OPEN`, `IN_PROGRESS`, `FIXED`, `VERIFIED`, `HYPOTHESIS`,
`NARROWED`, `DISPROVED`, `BLOCKED`, `DECISION_NEEDED`.

## Root causes

| ID | Title | Status | Phase | Files changed | Verification | Remaining risk |
|---|---|---|---|---|---|---|
| ROOT-001 | No canonical reporting domain model | OPEN | 2 | — | — | All metric/report consumers can drift |
| ROOT-002 | Browser acts as durable report worker | IN_PROGRESS | 0-2 | `supabase/migrations/20260915140000_reporting_job_storage_contract.sql`; `supabase/checks/check_reporting_job_storage_contract.sql`; `components/intelligence/reports/generate.ts` | Job schema/storage rollback check passes against current local SQL; generator rejects query/update errors and zero-row lifecycle updates; broad repository verification has unrelated baseline failures | Still browser-owned generation; production schema/deployment and durable worker remain unverified |
| ROOT-003 | Inconsistent analytics authorization boundary | IN_PROGRESS | 0 | `supabase/migrations/20260915130000_reporting_rpc_authorization.sql`; `supabase/checks/check_reporting_rpc_authorization.sql` | Current migration applied to local Supabase DB; rollback check passes all authorization, tenant, signature, and ACL assertions | Production deployment/schema state remains unverified; migration drift and production-schema reconciliation remain required |
| ROOT-004 | Migrations are not the deployed-schema source of truth | IN_PROGRESS | 0-1 | — | `migration_drift.js` failed | Local/prod history reconciliation required |
| ROOT-005 | No immutable provenance/explainability model | OPEN | 2-3 | — | — | Historical outputs cannot be audited |
| ROOT-006 | No trust-oriented report test system | IN_PROGRESS | 1 | `supabase/checks/check_report_capability_enforcement.sql`; `supabase/checks/check_reporting_rpc_authorization.sql`; `supabase/checks/check_reporting_job_storage_contract.sql`; focused reporting Vitest and source checks | All three reporting SQL rollback checks pass against current local DB; focused regression coverage is expanding; standard repo gate still has unrelated failures | Need production schema verification, mounted failure injection, and metric/UI/PDF/pathological suites |

## Child-item status index

The complete definitions, evidence, danger, proposed remediation, dependencies,
and acceptance tests for these IDs are in the canonical audit handoff. This
table is the implementation delta log.

| IDs | Initial status | Planned phase |
|---|---|---|
| SEC-001..SEC-005 | IN_PROGRESS — RPC containment migration/check added; latest current-SQL database verification pending | 0 |
| SEC-006..SEC-010 | OPEN; partial remediation in Tasks 6-7, exact child mapping not yet reconstructed | 0-1 |
| SEC-011 | OPEN — design invariant | 2 |
| SEC-012 | IN_PROGRESS — private bucket and requester/company/job-path Storage policy rollback check passes locally; production state pending | 0 |
| AN-001..AN-005 | IN_PROGRESS — verified Task 3 handles throughput period order/rate-change direction; zero scoped count was already preserved by `??` and is now centralized/tested; other grouped findings remain open pending item-level reconciliation | 0 |
| AN-006..AN-008 | OPEN | 0-2 |
| AN-009..AN-010 | DECISION_NEEDED | 0-2 |
| AN-011..AN-016 | OPEN | 0-2 |
| AN-017 | NARROWED | 0 |
| AN-018..AN-021 | OPEN | 1-2 |
| AN-022 | IN_PROGRESS / DECISION_NEEDED â€” overlap disclosure implemented; metric semantics still need owner decision | 1, 3 |
| REL-001..REL-003 | OPEN | 0 |
| REL-004..REL-014 | OPEN | 1-2 |
| PERF-001..PERF-008 | OPEN/HYPOTHESIS as recorded | 4 |
| UX-001..UX-014 | OPEN | 0, 3, 6 |
| PDF-001 | VERIFIED observation; target OPEN | 2-3 |
| PDF-002..PDF-008 | HYPOTHESIS/OPEN as recorded | 5 |
| PDF-009..PDF-011 | OPEN | 1, 5, 6 |
| OPS-001..OPS-003 | OPEN/NARROWED as recorded | 0-1 |
| OPS-004 | VERIFIED — migration/schema drift remains a deployment gate | 1 |
| OPS-005 | BLOCKED by thin seed | 0 |
| OPS-006..OPS-009 | OPEN | 1, 4, 5 |
| OPS-010 | VERIFIED risk | all |
| OPS-011..OPS-014 | OPEN | 2 |
| NAR-001..NAR-010 | DISPROVED/NARROWED — preserve, do not implement as bugs | none |
| PT-001..PT-023 | OPEN/HYPOTHESIS as recorded | 0-5 |
| AN-023 | VERIFIED (report task count corrected); medium confidence in legacy semantics | 1 |
| REL-015 | VERIFIED (required query and signed-URL failures now fail closed) | 1 |
| AN-024 | VERIFIED (conditional overlap disclosure); underlying team-attribution semantics remain DECISION_NEEDED | 1, 3 |
| REL-016 | VERIFIED locally (completion and failure-state updates reject errors/zero rows) | 1 |
| REL-017 | VERIFIED locally: RLS-hidden selected teams now abort instead of rendering UUID/zero totals | 0-1 |
| AN-027 | VERIFIED: Team Comparison now excludes soft-removed members from current membership and activity totals | 0-1 |
| AN-028 | VERIFIED: N-team points ranking represents all tied leaders and the actual maximum, including zero | 0 |
| AN-029 | VERIFIED: Team Comparison treats no-outcome success rates as unavailable and excludes them from the average | 0 |
| AN-030 | VERIFIED: Personnel reports preserve unavailable on-time/efficiency values instead of coercing to 0 | 0 |
| AN-031 | VERIFIED: Personnel ranking discloses all tied leaders and highlights the true maximum, including zero | 0 |
| AN-032 | VERIFIED: Empty Targets reports show N/A rather than a false 0% hit rate | 0 |
| AN-033 | VERIFIED: Worker head-to-head treats tied/invalid categories as undecided | 0 |
| AN-034 | VERIFIED: N-person Worker Comparison displays all tied leaders and excludes unavailable rates from averages | 0 |
| AN-035 | VERIFIED: Stage Dwell overall average weights stages by observed transition sample counts | 0 |
| AN-036 | VERIFIED: User Summary preserves missing timer efficiency/on-time rates as unavailable | 0 |
| AN-037 | VERIFIED LOCALLY: General Report no longer labels zero in both periods as NEW | 0 |
| AN-038 | VERIFIED LOCALLY: General Report leaderboard and top-performer insight rank by observed tasks/hour | 0 |
| AN-039 | VERIFIED LOCALLY: UI + transactional database rollback check pass; production gate open | 0 |
| AN-025 | VERIFIED (identical two-team metrics no longer award all ties to the first team) | 0-1 |
| AN-026 | VERIFIED mitigation: exact-count guards prevent silent Team Comparison truncation; data above configured cap now fails closed | 0-1 |

### Newly reconstructed Phase 1 ledger items

The original council's full handoff is not present in this checkout; the
available durable artifact is this grouped index plus its execution log. These
IDs are additive implementation findings discovered while executing the
existing ledger, not claims that the missing council handoff had these exact
IDs.

| ID | Category / subcategory | Severity / confidence | Evidence / current behavior | Risk and desired behavior | Verification / status | Remediation, dependency, acceptance, order |
|---|---|---|---|---|---|---|
| AN-023 | Analytics / Personal Pulse task count and timeframe label | MEDIUM / HIGH for count bug; MEDIUM for intended all-time semantics | `components/intelligence/reports/generate.ts:196-207` reads Supabase `count` from the result object and supplies it as `taskCount`; old code read `count` from `data` while using `head: true`, yielding null and displaying zero. `components/intelligence/reports/PersonalPulseReport.tsx:66` formerly claimed “Assigned over 30 days” though the query had no date predicate. | A polished report could claim zero tasks regardless of assigned tasks; the label asserted a bounded period for an unbounded query. Keep exact count from response metadata, reject null/negative/non-integer counts rather than convert them to zero, preserve legitimate zero, and label all-time scope accurately unless assignment timestamps are introduced. | VERIFIED by focused helper tests (zero, nonzero, null, negative, query error) and source-contract check verifying top-level count plumbing; the schema probe found `task_participants` has no assignment timestamp. No mounted Supabase-query integration test; uniqueness/distinct-task semantics remain a HYPOTHESIS (rows may or may not duplicate a task). | Local fix in generator/report label and validated count helper. Depends on no product decision for interim all-time count. Acceptance: Supabase `{count: 0, data: null, error: null}` renders 0; invalid or failed count query fails job; nonzero top-level count is propagated; label matches all-time query. Phase 1. |
| REL-015 | Reliability / ancillary report reads and export readiness | HIGH / HIGH | `components/intelligence/reports/generate.ts:27-42, 235-263, 584-610`; company/worker/pipeline label lookups, project pipeline/task reads, Personal Pulse count previously ignored errors; signed URL errors were ignored and completion was persisted before verifying a usable URL. | A report could look complete while containing fallback labels or incomplete project data; job could be marked complete without a downloadable file URL. Required reads and URL creation must fail the job before completion. | VERIFIED by `ReportGenerationSafety.check.ts`, focused test group, Babel and successful web build (latest build predates only docs); no live fault-injection test against each Supabase query/storage operation. | Local fail-closed checks; project semantics unchanged. Depends on existing error lifecycle update path. Acceptance: each required read error prevents completion; signed-URL error/empty URL leaves job non-completed and records failure; successful signed URL is returned only after persisted completion. Phase 1. |
| AN-024 | Analytics / shared-member attribution disclosure | HIGH / HIGH that members may occur in multiple team memberships; actual overlap in a given report is data-dependent | `components/intelligence/reports/generate.ts:90-132` computes team metrics over each team's current members; `components/intelligence/reports/TeamComparisonReport.tsx:45-83, 99-145` compared totals without disclosing that the same member may contribute to multiple teams. | Where membership overlaps, a person’s completed/failed tasks and work sessions appear in more than one team's totals, making group comparisons look mutually exclusive. Safest interim is disclose each distinct overlapping member and that their activity is counted in each selected team's metrics; do not invent a winner-score adjustment. | Calculation VERIFIED with duplicate IDs within one team and overlap across 3 teams; source-contract check ensures generator wiring and both report layouts include disclosure. Real-world incidence is unverified; semantics remain linked to AN-022 decision gate. | Local calculation + report copy. Depends on existing team member query/RLS. Acceptance: no-overlap count is zero and no warning; overlap counts unique users across selected teams and warning appears in both two-team and N-team layouts; same team ID repeated in parameters cannot create false overlap (IDs are deduplicated). Phase 1 mitigation, Phase 3 product decision. |

## Execution log

| Date | Package | Ledger IDs | Status | Files changed | Verification evidence | Remaining risk |
|---|---|---|---|---|---|---|
| 2026-09-15 | Audit and target architecture | all | VERIFIED design/audit only | none | Council audit, live SQL probes, focused SQL checks, repository verification recorded in handoff | Implementation not yet applied |
| 2026-09-15 | Phase 0 execution preparation | ROOT-003/004/006 | IN_PROGRESS | `docs/REPORTING_REMEDIATION_LEDGER.md`, `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | Plan/ledger self-review pending | Existing dirty reporting changes require in-place integration |
| 2026-09-20 | Task 1 authorization containment | ROOT-003; SEC-001..SEC-005; ROOT-006 | IN_PROGRESS | `supabase/migrations/20260915130000_reporting_rpc_authorization.sql`; `supabase/checks/check_reporting_rpc_authorization.sql` | Current code independently reviewed by Luna: PASS, no blocker; migration applied to local DB; latest rollback SQL check passes. Check exposed a pre-existing explicit `service_role` EXECUTE grant; migration now revokes that role from all public reader wrappers as required by the check. `git diff --check` passed | Production schema remains unverified. `migration_drift.js` reports 19 migration files with missing local objects and 227 live objects unnamed by migration files; production migration reconciliation is required |
| 2026-09-20 | Task 2 report job + Storage containment | ROOT-002; ROOT-006; SEC-012; REL-001..REL-003; PDF-009 | IN_PROGRESS | `supabase/migrations/20260915140000_reporting_job_storage_contract.sql`; `supabase/checks/check_reporting_job_storage_contract.sql`; `components/intelligence/reports/generate.ts` | Static review caught/fixed missing requester-only UPDATE policy (active browser generator updates lifecycle), retained legacy `error_msg` after copying to avoid data-destructive drop, added own-update check; generator writes lifecycle timestamps and rejects DB errors/zero-row start updates. Migration applied locally; self-contained fixture rollback RLS/Storage contract check passes. `verify:agent` web export passes | Browser-owned generation remains until durable worker architecture. Production migration deployment/schema reconciliation remains outstanding; `verify:agent` and migration drift have unrelated/baseline failures listed under Task 8 |
| 2026-09-20 | Task 3 deterministic calculation helpers | AN-001..AN-005 (partial; period-order trend and rate semantics); ROOT-006 | VERIFIED package | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/ThroughputReport.tsx`; `components/intelligence/reports/generate.ts` | Six focused Vitest tests pass; expected RED was module-not-found before helper; strict isolated `tsc` passes; Babel checks pass for touched TS/TSX; `npm run build:web` succeeds; full-project `tsc` has unrelated baseline drift with no diagnostics matching these changed reporting paths | No real PDF visual render or DB-backed data run. Zero scoped fallback was already correct via nullish coalescing, so change centralizes/test-protects existing behavior rather than repairing a reproduced production defect. Remaining AN findings stay open until item-level reconciliation |
| 2026-09-20 | Task 4 custom calendar-timeframe normalization | AN-004; AN-019; ROOT-006 | VERIFIED package | `lib/reporting/reportTimeframe.ts`; `lib/reporting/reportTimeframe.test.ts`; `components/intelligence/ReportGeneratorTimeframe.check.ts`; `components/intelligence/_ReportGenerator_desktop.tsx`; `components/intelligence/_ReportGenerator_adaptive.tsx`; `components/intelligence/reports/generate.ts` | Initial expected RED (normalizer module absent); focused Vitest 13/13 pass; integration check passes (invalid guard precedes job expansion/RPC); Babel checks and isolated strict TypeScript pass; `npm run build:web` passes. `verify:agent` was stopped during broad self-checks after failures were observed in sibling `.worktrees/issue-414-defaults-catalog` and at least one unrelated root FileHub check; full Vitest/tsc phases were not reached. Tests cover UTC, Cairo, year/leap, DST spring/fall, malformed/reversed dates, invalid timezone, Apia skipped date, and microsecond inclusive bound. Legacy inclusive RPCs receive endInclusiveUtc while canonical exclusive bound/timezone/local dates are persisted; stage-dwell date-only RPC receives local date strings | No DB-backed RPC execution. Existing SQL inclusive contracts were inspected in migration sources; actual deployed RPC signatures still need DB validation when Docker is restored. Requester timezone is the documented safe interim. Browser-owned generation remains |
| 2026-09-20 | Task 5 native/partial-read containment | ROOT-002; ROOT-006; REL-001..REL-003 (partial) | VERIFIED package | `lib/reporting/reportData.ts`; `lib/reporting/reportData.test.ts`; `components/intelligence/ReportGenerationSafety.check.ts`; `components/intelligence/_ReportGenerator_adaptive.tsx`; `components/intelligence/reports/generate.ts` | RED observed for missing module, unsafe Supabase error formatting, malformed timestamps accepted by Date.parse, and missing native guard. Focused reporting Vitest 27/27; both generator source-contract checks pass; Babel and isolated strict TypeScript pass; `npm run build:web` passes; graph refreshed. Team report now fails on each required read error and invalid/negative session durations; native adaptive generation is guarded before expansion/RPC and UI explains web-only availability | No native runtime or DB-backed query fault injection. Browser remains generation owner on web; no server worker. Existing full `verify:agent` was not completed (see Task 4 gate evidence); run broad verification again after Phase 0 packages and classify baseline/sibling-worktree failures |
| 2026-09-20 | Task 6 authenticated analytics cache scope | ROOT-003; ROOT-006; SEC-006..SEC-010 (cache-isolation symptom; exact child attribution awaits canonical handoff reconciliation) | VERIFIED package | `contexts/AnalyticsContext.tsx`; `contexts/AnalyticsCacheScope.check.ts`; `lib/analyticsCache.ts`; `lib/analyticsCache.test.ts` | Focused Vitest 8/8; context source-contract check passes; Babel checks pass; `npm run build:web` succeeds; `git diff --check` passes; `graphify update .` completes. Composite cache/in-flight keys now include user, company, permissions, role IDs, and permission-load state; auth-scope transitions clear both maps; stale in-flight completions cannot repopulate/return cross-scope data; logical-prefix invalidation preserved | No mounted-provider auth-transition/fetch race test; auth-scope correctness has unit and static integration coverage. Reconcile exact SEC child mapping against canonical full audit when available; broad `verify:agent` ran and failed only on unrelated/sibling FileHub, ProjectFilesTab, baseline TypeScript and Windows wrapper issues; independent endpoints still rely on their own server authorization |
| 2026-09-20 | Task 7 generation capability and compensation redaction | SEC-006..SEC-010 (partial; do not bulk-close pending canonical child mapping); SEC-007; AN-014; ROOT-006 | VERIFIED package | `lib/capabilities.ts`; `lib/capabilities.test.ts`; `lib/reporting/reportParameters.ts`; `lib/reporting/reportParameters.test.ts`; `components/intelligence/ReportCapabilitySafety.check.ts`; `components/intelligence/_ReportGenerator_desktop.tsx`; `components/intelligence/_ReportGenerator_adaptive.tsx`; `components/intelligence/reports/generate.ts`; `components/intelligence/reports/PersonnelReport.tsx`; `supabase/migrations/20260915124000_report_capability_enforcement.sql`; `supabase/checks/check_report_capability_enforcement.sql` | Expected RED reproduced for view/export permission and absent redaction helper. 32 focused capability/redaction tests pass; combined reporting regressions 59/59; static cross-layer safety check passes; Babel checks and strict helper/test TS pass; web export succeeds; updated migration applied to local Supabase DB; rollback SQL check passes, including view/export-only denial, owner allowance, entitlement enforcement, recursive job-parameter redaction, and helper ACLs; graph refresh completes | Salary-driven PDF cost output/input now intentionally unavailable until approved rate source and retention policy exist (safe interim per AN-014 decision). No dedicated persisted audit-event table assertion (RPC source and helper are checked; event log receives the same sanitized JSON). Generic SEC child mapping remains partially unresolved |
| 2026-09-20 | Task 8 Phase 0 integrated verification | ROOT-002; ROOT-003; ROOT-006; SEC-001..SEC-012; REL-001..REL-003; PDF-009 | VERIFIED WITH KNOWN FAILURES | `supabase/checks/check_report_capability_enforcement.sql`; `supabase/checks/check_reporting_rpc_authorization.sql`; `supabase/checks/check_reporting_job_storage_contract.sql`; `supabase/migrations/20260915130000_reporting_rpc_authorization.sql`; `supabase/migrations/20260915140000_reporting_job_storage_contract.sql`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | All three SQL rollback checks pass on local Supabase after applying current Task 1/2/7 migrations. Focused reporting tests 59/59; targeted Vitest tests 32/32; Babel and strict changed-helper/test TypeScript pass; web build passes. `verify:agent` exits 1: self-checks 141/145 (3 failures under sibling `.worktrees/issue-414-defaults-catalog` in `UploadComposerModal.check.ts`, `UploadSheet.check.ts`, `useWebDnd.smartpaste.check.ts`; 1 root `hooks/useWebDnd.smartpaste.check.ts`), Vitest 3 failures in `components/projects/ProjectFilesTab.test.tsx` (1,923 pass, 92 skipped), checked TS baseline mismatch from unrelated dirty/sibling files (the only Task 7 test diagnostic was fixed and isolated tsc now passes), Babel wrapper path error `'C:\Program'`, web export PASS. Standalone migration drift exits 1: 19 files with repo objects missing locally, 227 live DB objects not named in migrations; DB linter has unrelated errors in `rpc_search_users`, `rpc_set_project_field_values`, `rpc_toggle_stage_feature` and pre-existing warnings | Do not mark broad gate/DB lineage clean. Production schema not tested. Preserve unrelated FileHub/ProjectFilesTab/guide/type drift for separate remediation; rerun after deployment lineage is reconciled |
| 2026-09-20 | Task 9 Personal Pulse count and report fail-closed reads | AN-023; REL-015; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/generate.ts`; `components/intelligence/reports/PersonalPulseReport.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `lib/reporting/reportData.ts`; `lib/reporting/reportData.test.ts` | Test-first helper addition: initial attempt exposed a source-check contract mismatch, updated to the validated-count contract. Focused Vitest: 6 files, 69 tests pass; report safety source-contract check passes; Babel checks pass for touched TS/TSX/check; strict isolated `tsc` passes for `reportData.ts`; `npm run build:web` succeeds; `git diff --check` passes. | No DB-backed fault injection/mounted generator test; all-time assignment count may count participant rows rather than distinct tasks if duplicate rows exist; local DB schema has no assignment timestamp. Broader verification still has unrelated failures documented in Task 8 |
| 2026-09-20 | Task 10 migration lineage read-only verification | ROOT-004; OPS-004; ROOT-006 | VERIFIED OBSERVATION; RECONCILIATION OPEN | `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/PROD_MIGRATION_RECONCILIATION_2026-09-15.md` | `node supabase/checks/migration_drift.js`: 19 migration files with missing local objects and 227 live DB objects not named by migration files. Read-only Docker inspection confirms local `supabase_migrations.schema_migrations` exists but has 0 rows. `supabase` CLI is unavailable. Repository reconciliation guidance prohibits migration up/repair/reset shortcuts and production deployment from a moving dirty worktree. | Cannot establish production equivalent schema or safely reconcile from an empty local ledger here. Requires frozen migration set, production backup, rehearsal DB, dependency review, and owner-approved production window per reconciliation guide; no migration state changed. |
| 2026-09-20 | Task 11 shared-team overlap disclosure | AN-022; AN-024; ROOT-006 | VERIFIED LOCALLY; BUSINESS SEMANTICS OPEN | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/generate.ts`; `components/intelligence/reports/TeamComparisonReport.tsx`; `components/intelligence/ReportGenerationSafety.check.ts` | RED reproduced for missing overlap helper. Focused calculations/data tests: 18/18; report safety source-contract check, Babel, strict isolated calculation-helper `tsc`, web export, and `git diff --check` pass. Report now reports the number of distinct members belonging to multiple selected teams and explains duplicated activity inclusion in both comparison layouts; duplicate selected team IDs are normalized. | No DB-backed seeded overlap run or visual PDF screenshot. Whether the product should reattribute, exclude, or otherwise adjust shared work remains a product decision; safe current behavior is explicit disclosure only. |
| 2026-09-20 | Task 12 report job terminal-state verification | ROOT-002; REL-016; ROOT-006 | VERIFIED LOCALLY | `lib/reporting/reportData.ts`; `lib/reporting/reportData.test.ts`; `components/intelligence/reports/generate.ts`; `components/intelligence/ReportGenerationSafety.check.ts` | RED reproduced for missing mutation-row guard. Helper/calculation tests: 19/19; source-contract check, Babel, strict isolated helper TypeScript, and `npm run build:web` pass; `git diff --check` passes. | No live RLS/network fault injection; failure-state persistence may be impossible during DB outage, but the secondary failure is surfaced instead of silently discarded. |
| 2026-09-20 | Task 13 neutral comparison ties | AN-025; ROOT-006 | VERIFIED LOCALLY; PDF VISUAL CHECK OPEN | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/TeamComparisonReport.tsx`; `components/intelligence/ReportGenerationSafety.check.ts` | RED reproduced for missing tally helper. Focused tests: 22/22 across calculation/data modules; source-contract, Babel, and strict isolated helper TypeScript pass; `npm run build:web` succeeds; graph refresh and `git diff --check` pass. | No actual business dataset was rendered and no local Poppler/pdfinfo tooling is installed, so page-level visual fit remains unverified. Current category/winner rule is preserved; equal categories are no longer awarded to Team A. |
| 2026-09-20 | Task 14 guard Team Comparison API-cap truncation | AN-026; REL-017; PERF-001..PERF-008 (containment only); ROOT-006 | VERIFIED LOCALLY; server aggregation OPEN | `lib/reporting/reportData.ts`; `lib/reporting/reportData.test.ts`; `components/intelligence/reports/generate.ts`; `components/intelligence/ReportGenerationSafety.check.ts` | RED reproduced for missing exact-count guard and missing requested-team check. Tests cover exact, empty, truncated, missing-count, and requested-vs-visible rows; all six report reads assert exact count + explicit 1,000-row range + completeness, and selected team scope asserts expected row count. Full focused suite: 79/79; safety check, Babel, strict isolated helper TypeScript, web export, `git diff --check`, and graph refresh pass. | Large reports above 1,000 raw rows per query now fail visibly rather than undercount. Query fan-out and server-side aggregation remain unresolved performance work. No live cross-tenant RLS fixture in this package. |
| 2026-09-20 | Task 15 exclude removed team members | AN-027; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/generate.ts`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md` | Regression source check observed RED before implementation, then passed after adding `removed_at IS NULL` to the membership query. Full focused suite 79/79; source check, Babel, strict helper TypeScript, serial web export, and `git diff --check` pass. Parallel web export once failed to resolve an existing adaptive module; serial retry passed. | No populated report dataset rendered; active membership semantics are supported by local partial index and existing SQL guards. |
| 2026-09-20 | Task 16 disclose N-team points ties | AN-028; ROOT-006 | VERIFIED LOCALLY | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/TeamComparisonReport.tsx`; `components/intelligence/reports/TeamComparisonReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | RED reproduced (2 tests failed before helper). Focused reporting + PDF tests: 5 files/46 tests pass; PDF render tests pass for tied and all-zero three-team reports (2/2), producing valid >1KB buffers; report safety source check passes; Babel and `git diff --check` pass. Full `verify:agent`: 146/150 self-checks (sibling-worktree FileHub mismatches and one root adaptive FileHub mismatch); Vitest 3 unrelated `ProjectFilesTab.test.tsx` failures (1,948 pass/92 skipped); checked TypeScript baseline mismatch from unrelated diagnostics (after fixing the transient two test-harness type errors, changed reporting paths are absent from diagnostics); Babel wrapper fails on Windows path quoting (`'C:\Program'`); web export passes; local DB linter reports existing unrelated errors. | Renderer successfully generates the pathological cases, but page-level visual review and extracted-text assertions remain unavailable without PDF inspection tooling. Broad gate is red for unrelated known baseline/worktree failures; full evidence remains in command output and prior Task 8 entry. |
| 2026-09-20 | Task 17 re-run local reporting security/storage rollback checks | SEC-001..SEC-012; ROOT-003; ROOT-006 | VERIFIED LOCALLY; PRODUCTION GATE OPEN | `supabase/checks/check_reporting_rpc_authorization.sql`; `supabase/checks/check_reporting_job_storage_contract.sql`; `supabase/checks/check_report_capability_enforcement.sql`; `docs/REPORTING_REMEDIATION_LEDGER.md` | Ran all three checks through `docker exec ... psql -v ON_ERROR_STOP=1` against current local Supabase DB. RPC check passed anonymous rejection, permissionless rejection, authorized access, and cross-tenant rejection; report job/Storage lifecycle check completed and rolled back; capability enforcement check passed and rolled back. No data changes persisted. | Local validation only. Production schema/migration lineage remains unverified and is blocked on owner-controlled frozen migration reconciliation, rehearsal, backup, and deployment window; no production state was changed. |
| 2026-09-20 | Task 18 distinguish no task outcomes from 0% success | AN-029; ROOT-006 | VERIFIED LOCALLY | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/TeamComparisonReport.tsx`; `components/intelligence/reports/TeamComparisonReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | RED reproduced for both absent helpers. Reporting + PDF Vitest: 5 files/49 tests pass, including denominator/null/negative cases and a PDF smoke test with a no-outcome team; report source contract passes; strict isolated helper TypeScript and Babel pass; serial web export passes; `git diff --check` passes with only pre-existing line-ending warnings. Full repository gate has unrelated failures recorded in Task 16. | No design change to the unweighted average among teams with outcomes; PDF visual/text extraction unavailable. |
| 2026-09-20 | Task 19 preserve missing Personnel metrics | AN-030; ROOT-006 | VERIFIED LOCALLY | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/PersonnelReport.tsx`; `components/intelligence/reports/PersonnelReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | Reporting + PDF Vitest: 6 files/51 tests pass; mixed observed/null Personnel data renders a valid PDF (smoke check); safety source contract passes; isolated strict helper TypeScript and Babel pass; serial web export passes; `git diff --check` passes with pre-existing line-ending warnings. | Upstream SQL null/zero semantics for each RPC-produced Personnel field need data-backed verification; no PDF visual/text extraction available. |
| 2026-09-20 | Task 20 disclose tied top Personnel performers | AN-031; AN-028; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/PersonnelReport.tsx`; `components/intelligence/reports/PersonnelReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | RED reproduced by source contract before integration. Reporting + PDF suite: 6 files/52 tests pass, including tied all-zero Personnel PDF render; source contract, strict helper TypeScript, Babel, web export, and `git diff --check` pass. | PDF render smoke test verifies valid output but cannot inspect visual tie text without a PDF parser/viewer. |
| 2026-09-20 | Task 21 represent empty target hit rate as unavailable | AN-032; ROOT-006 | VERIFIED LOCALLY | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/TargetsReport.tsx`; `components/intelligence/reports/TargetsReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | Reporting/PDF suite: 7 files/54 tests pass; empty Targets PDF render passes; report source contract, strict helper TypeScript, Babel, serial web export, and `git diff --check` pass. | Existing non-empty hit/all-targets semantics remain unchanged; whether denominator should exclude active targets is not asserted without product definition. |
| 2026-09-20 | Task 22 neutralize Worker head-to-head metric ties | AN-033; AN-025; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/WorkerComparisonReport.tsx`; `components/intelligence/reports/WorkerComparisonReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | RED reproduced: source guard failed before tie-aware helper integration. Reporting/PDF suite: 8 files/55 tests pass; identical-worker PDF smoke test passes; source guard, strict helper TypeScript, Babel, serial web export, and `git diff --check` pass. | Category choice/direction unchanged; no real report data PDF visual review. |
| 2026-09-20 | Task 23 align N-person Worker Comparison ranking/null semantics | AN-034; AN-030; AN-031; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/WorkerComparisonReport.tsx`; `components/intelligence/reports/WorkerComparisonReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | Reporting/PDF suite: 8 files/56 tests pass; tied-zero/mixed-null N-person PDF smoke case passes; source contract, strict helper TypeScript, Babel, serial web export, and `git diff --check` pass. | Upstream RPC zero-vs-null semantics and visual PDF review remain unverified. |
| 2026-09-20 | Task 24 sample-weight Stage Dwell aggregate | AN-035; ROOT-006 | VERIFIED LOCALLY | `lib/reporting/reportCalculations.ts`; `lib/reporting/reportCalculations.test.ts`; `components/intelligence/reports/StageDwellReport.tsx`; `components/intelligence/reports/StageDwellReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | RED reproduced for missing weighted-average helper. Reporting/PDF suite: 9 files/58 tests pass; 90s×1 + 10s×9 calculates 18s; empty samples produce N/A; source contract, strict helper TypeScript, Babel, serial web export, and `git diff --check` pass. | RPC `avg_seconds` is rounded to bigint, so weighted summary has at most rounding error from stage means; no raw sum is exposed. Bottleneck threshold's stage-level baseline remains unchanged. |
| 2026-09-20 | Task 25 preserve missing User Summary rates | AN-036; AN-030; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/UserSummaryReport.tsx`; `components/intelligence/reports/UserSummaryReport.test.tsx`; `components/intelligence/ReportGenerationSafety.check.ts`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | Focused reporting/PDF Vitest: 6 files/10 tests pass, including User Summary PDF smoke render; report source-contract check and Babel checks pass. | Historical RPC definition is not present in repository migrations, so nullable source semantics and visually extracted PDF text remain unverified. |
| 2026-09-20 | Task 26 neutralize zero-to-zero General Report comparison label | AN-037; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/GeneralReport.tsx`; `components/intelligence/reports/GeneralReport.test.tsx`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | Focused helper tests cover zero-to-zero, zero-to-positive, and positive-prior unchanged/increase/decrease behavior; focused report suite 7 files/13 tests, report safety check, Babel, `git diff --check`, web export, and graph refresh pass. Full-project `npx tsc --noEmit` exits 2 on archived Deno/implicit-any diagnostics; no diagnostics match either changed GeneralReport file. | SQL `COALESCE(...,0)` can conflate no observations with a true zero; this fix intentionally reports literal `0 in both periods`, not an analytics-semantic claim. Full typecheck remains red. |
| 2026-09-21 | Task 27 rank General Report productivity by tasks/hour | AN-038; ROOT-006 | VERIFIED LOCALLY | `components/intelligence/reports/GeneralReport.tsx`; `components/intelligence/reports/GeneralReport.test.tsx`; `docs/REPORTING_REMEDIATION_LEDGER.md`; `docs/superpowers/plans/2026-09-15-reporting-phase-0-containment.md` | Focused reports: 7 files/18 tests; safety check, Babel, web export, graph refresh, and diff check pass. Adversarial cases cover conflicting hours/rate order, a worker outside the former first eight, ties, invalid observations/overflow, and preserving input order for People Detail. Full TypeScript remains baseline-red on archived Deno diagnostics; no changed-file diagnostics. | No populated report data/PDF visual inspection; worker-time RPC still orders by hours (preserved for other report consumers); zero-denominator semantics remain unavailable. |
| 2026-09-21 | Task 28 preserve undefined organizational-audit metrics | AN-039; ROOT-006 | VERIFIED LOCALLY; PRODUCTION GATE OPEN | `supabase/migrations/20260921063116_analytics_audit_empty_sample_semantics.sql`; `supabase/checks/check_analytics_audit_empty_sample_semantics.sql`; `components/intelligence/reports/GeneralReport.tsx`; `components/intelligence/reports/GeneralReport.test.tsx`; `lib/analyticsMetrics.ts`; `lib/analyticsMetrics.test.ts`; `components/intelligence/RadarWidgets.tsx`; `components/intelligence/_graphs_adaptive.tsx`; ledger and plan | Combined report/helper suite 8 files/30 tests; safety check, Babel on all changed UI/helper files, web export and `git diff --check` pass. Full `npx tsc --noEmit` exits 2 on repository diagnostics; one unrelated existing nullable `conversion_by_stage` error at `RadarWidgets.tsx:236`, none in changed trend-card block, GeneralReport, or analytics helper. Local PostgreSQL rollback run: temporary function replacement + fixture passed null/zero, output-key, authorization/tenant, owner/SECURITY DEFINER/search_path/ACL checks; final rollback restored the original definition; no history/data persisted. | PDF visual check remains open; graph refresh after wider consumer edits stalled after AST extraction and is not claimed; production migration remains owner-gated. |
| 2026-09-21 | Task 29 mounted analytics-cache principal-transition regression | ROOT-003; ROOT-006; SEC-006..SEC-010 mapping unresolved | READY FOR LUNA; NO CODE CHANGED | Planned exclusive test ownership: new `contexts/AnalyticsContext.test.tsx`; reference `contexts/AnalyticsContext.tsx:223-274`, `contexts/AnalyticsCacheScope.check.ts`, `lib/analyticsCache.test.ts` | Repository search confirms the cache scope and in-flight invalidation have helper/source-contract coverage but no mounted AnalyticsProvider auth-transition test. Plan is to test settled-cache separation and stale deferred requests across user/company change. | This runtime lacks agent-spawn capability; package awaits parent Luna dispatch. Keep production files out of scope unless RED proves a defect, then return evidence to Sol for scope approval. Do not assign this residual to a specific SEC child without the original audit mapping. |

### REL-016 â€” Report job terminal-state persistence

- Category: reliability / report lifecycle; severity HIGH; confidence HIGH.
- Evidence: `components/intelligence/reports/generate.ts:598-625` previously
  checked completion errors but not RLS-hidden/zero-row results before returning
  a signed URL; failure-state updates ignored database errors and zero-row
  responses.
- Risk: generation could return success while the job remains `processing`, or
  leave a failed job stuck in `processing` without telling the caller that
  failure state was not persisted.
- Status: VERIFIED locally with pure helper tests for updated row, DB error, and
  zero-row cases, plus a source-contract check for completion and failure paths.
  No live RLS fault injection was available.
- Remediation: require a returned updated row for both terminal transitions;
  surface secondary failure-persistence errors alongside the original error.
- Acceptance: URL only returns after the row confirms completion; completion
  error/zero-row throws; failure-state error/zero-row is included in the thrown
  error while preserving the original cause. Phase 1.

### AN-025 - Tied comparison categories biased toward Team A

- Category: analytics / ranking; severity HIGH; confidence HIGH; silent.
- Evidence: `components/intelligence/reports/TeamComparisonReport.tsx` used
  `>=` for higher-is-better categories and `<=` for failed tasks, awarding every
  equal category to the first selected team. Identical teams appeared as a Team A
  win across all six measured categories.
- Status: VERIFIED by expected RED tests and helper tests for all-tie, mixed
  decisive/tied, invalid, higher-is-better, and lower-is-better cases.
- Remediation: equal/invalid values are undecided; only strict wins count.
  Existing measured categories and majority rule are unchanged.
- Acceptance: identical metrics produce no winner and zero decided categories;
  tied categories vote for neither team; lower failed count remains better.
  Local calculation/presentation change, Phase 0 correctness.

### AN-026 - Team Comparison reads can exceed the API row cap

- Category: analytics / aggregation completeness; severity HIGH; confidence
  HIGH for the cap and missing guard, conditional on row volume for manifestation.
- Evidence: `supabase/config.toml:18` sets `api.max_rows = 1000`; prior code
  fetched teams, members, participants, tasks, and sessions without ranges or
  exact-count validation.
- Risk: after a read exceeded the API cap, the report could show plausible but
  incomplete membership, task, points, and hours totals.
- Status: VERIFIED mitigation. Six Team Comparison reads now request exact
  counts, explicitly range the first 1,000 rows, and reject any count/row-length
  mismatch before calculating or completing the PDF. Empty and exact-cap results
  are valid; incomplete/missing-count results fail closed.
- Remediation: the local guard prevents silent truncation. Long-term remedy is
  server-side aggregation/keyset pagination; this guard deliberately rejects
  above-cap reports in the interim.
- Acceptance: exact count equal to response rows is accepted; count/rows
  mismatch, missing/invalid count, or query error fails generation; member work
  sessions still contribute when no participant rows exist. Phase 0 containment
  / Phase 4 scaling.

### REL-017 - RLS-hidden requested team presented as a zero-valued team

- Category: reliability / filtering and authorization feedback; severity HIGH;
  confidence HIGH for behavior, conditional on an inaccessible/missing ID.
- Evidence: `components/intelligence/reports/generate.ts` accepted an exact
  empty response for requested `team_ids`, then built zero stats and fell back
  to the raw ID as team name.
- Risk: a polished report could imply a real selected team had zero activity,
  masking RLS denial, deletion, stale selection, or an invalid ID.
- Status: VERIFIED mitigation through `requireCompleteReportRows` expected-count
  test and generator source-contract check; no live cross-tenant RLS fixture run
  during this package.
- Remediation: require all normalized requested team IDs to be visible in the
  caller-scoped team lookup before calculating report totals.
- Acceptance: selected count equals visible team count or generation fails;
  normal visible selections continue; no raw UUID/zero placeholder is generated.
  Local, Phase 0.

### AN-027 - Soft-removed team members counted in current comparison metrics

- Category: analytics / filtering and aggregation; severity HIGH; confidence
  HIGH. Silent, with materiality depending on whether a team has removed members.
- Evidence: `components/intelligence/reports/generate.ts` queried
  `team_members` by `team_id` without a `removed_at IS NULL` filter. The local
  schema has a partial active-members index (`idx_team_members_active`), and
  existing authorization/notification migrations consistently use
  `removed_at IS NULL` when deriving current team membership.
- Risk: former team members could inflate the member count and contribute their
  tasks and session hours to a current team comparison.
- Status: VERIFIED fix; `ReportGenerationSafety.check.ts` regression guard was
  observed RED before the filter was added and passes afterward. No populated
  live report fixture was rendered.
- Remediation: constrain membership reads to active rows before calculating
  member IDs, overlap, tasks, and hours.
- Acceptance: removed membership rows never enter team counts or related
      activity queries; active team membership still does. Local filter fix, Phase 0.

### AN-028 - N-team point ranking hides tied leaders and misidentifies zero maxima

- Category: analytics / report presentation; severity HIGH; confidence HIGH.
  Silent and visually persuasive.
- Evidence: `components/intelligence/reports/TeamComparisonReport.tsx` used a
  strict `>` reduction, selecting the first team when multiple teams shared the
  maximum, while the insight said that team "leads". Its `Math.max(..., 1)` floor
  also meant all-zero teams were not highlighted as the actual point maximum.
- Risk: users could infer an unsupported single winner, and the visual ranking
  could disagree with the data for zero/negative maxima. Desired behavior is
  report every tied leader, use the actual maximum without an arbitrary floor,
  and use neutral accurate copy for ties.
- Reproduction: N-team points `[18,25,25,10]` picked only the first 25-point
  team; `[0,0]` set the apparent max to 1. RED test reproduced missing helper.
- Status: VERIFIED LOCALLY. Reporting tests cover multiple tied maxima, zero and negative maxima, plus empty input; source-contract check guards report wiring and tie copy. `@react-pdf/renderer` produced valid PDF buffers for tied and all-zero pathological reports. Page-level visual review and PDF text extraction remain unavailable because this environment has no PDF inspection utility.
- Remediation: pure `findTopTeamPointLeaders` helper; render all maxima as top
  leaders, highlight actual maximum, and distinguish singular/plural KPI and
  insight copy. Local fix, Phase 0 correctness/presentation.
- Acceptance: helper returns all teams at the true max (including zero and
  negative values), returns null for empty input; report never labels one of
  multiple leaders as sole leader and highlights every actual maximum.

### AN-029 - Teams with no outcomes appear as 0% success and depress the average

- Category: analytics / null and denominator semantics; severity HIGH; confidence
  HIGH for current behavior and its mathematical ambiguity. Silent.
- Evidence: `components/intelligence/reports/TeamComparisonReport.tsx` returned
  `0` from the success-rate helper when `completed + failed` was zero, then
  included that fabricated zero in the unweighted group average. The same zero
  was displayed as if measured in the two-team and N-team views.
- Risk: no observations are not evidence of zero success; one empty team could
  lower the average and appear to underperform. Preserve measured 0% when there
  are failed outcomes and zero completions, but display unavailable for a zero
  denominator. Keep the established unweighted mean over teams with observed
  outcomes; show N/A if none are observed.
- Reproduction: three teams with rates [80%, no outcomes, 0%] previously yielded
  26.7%; the defined average over observed teams is 40%. Empty-only groups had
  appeared as 0%.
- Status: VERIFIED LOCALLY. Focused analytics and PDF tests plus source contract, strict helper TypeScript, Babel, web export, and diff check pass. The broad repository gate remains red for unrelated baseline/worktree failures documented under Task 16.
- Remediation: validated denominator-aware rate and average helpers; unavailable
  presentation is neutral and undecided in head-to-head scoring. Local fix,
  Phase 0 analytics correctness.
- Acceptance: zero denominator/missing/negative counts yield null; observed 0%
  remains 0%; group average excludes nulls and returns null if all rates are
  unavailable; PDF displays an em dash per empty team and N/A for an empty group.

### AN-030 - Missing Personnel rates appear as measured zero and depress averages

- Category: analytics / null semantics; severity HIGH; confidence HIGH for
  frontend coercion, MEDIUM for upstream meaning of every nullable field. Silent.
- Evidence: `components/intelligence/reports/PersonnelReport.tsx` used
  `(r.on_time_rate || 0)` and `(r.timer_efficiency || 0)` in group averages,
  rendered absent values as `0.0%`, and colored them as measured values.
- Risk: unknown measurements become plausible scores and shift averages. Desired
  behavior is preserve finite observations (including true zero), exclude
  null/undefined/non-finite observations, render unavailable rows as an em dash,
  and show N/A when no values are observed.
- Reproduction: for on-time values `[80, null]`, prior display/average was 40%;
  the observed average is 80%. Same null coercion affected timer efficiency.
- Status: VERIFIED LOCALLY. Helper tests cover missing, non-finite, and observed
  rates; a PDF render smoke case covers mixed observed/null input; source guard,
  strict isolated helper TypeScript, and Babel checks pass.
- Remediation: shared average-over-observations helper; neutral formatting and
  colors for missing row values; local report presentation change.
- Acceptance: true 0 remains 0; null/undefined/NaN are excluded; no observed
  values render N/A; PDF generation succeeds for mixed observed/missing rows.
  Phase 0 correctness. Upstream semantics and PDF visual fit remain open.

### AN-031 - Personnel ranking hides ties and uses an artificial point floor

- Category: analytics / ranking presentation; severity HIGH; confidence HIGH.
  Silent.
- Parent/root: same first-maximum ranking defect as AN-028 in a second report.
- Evidence: `components/intelligence/reports/PersonnelReport.tsx` used a strict
  `>` reduction for one top performer and `Math.max(..., 1)`, so equal leaders
  appeared as a unique winner and all-zero points were not the true maximum.
- Risk: users may infer unsupported individual superiority; zero-point ranking
  highlights can disagree with actual values. Desired behavior is all tied
  leaders reported and every actual maximum highlighted.
- Reproduction: identical point totals select the first input person; all-zero
  rows compare against max 1. Existing source-contract RED confirms missing
  tie-aware integration.
- Status: VERIFIED LOCALLY. Shared calculation, report safety contract, report/PDF tests, Babel, and web export pass. Visual PDF review remains open.
- Remediation: reuse shared leader calculation, pluralize KPI/insight copy for
  ties, and remove arbitrary floor. Local presentation fix, Phase 0.
- Acceptance: tied leaders are all represented; zero scores share the true max;
  singular language is used only for a unique leader; PDF generation succeeds.

### AN-032 - Empty target set reports 0% hit rate

- Category: analytics / denominator and empty state; severity MEDIUM; confidence
  HIGH. Silent but explicitly accompanied by an empty-state message.
- Evidence: `components/intelligence/reports/TargetsReport.tsx` returned zero
  when there were no target rows, then presented it as a measured `Hit Rate`.
- Risk: zero observations are not a 0% achievement result. Desired behavior is
  display N/A for an empty denominator while preserving the current hit/all
  configured targets formula for non-empty reports.
- Reproduction: `targets=[]` yielded `0 / 0`, mapped to 0%; target list was empty.
- Status: VERIFIED LOCALLY. Focused analytics/PDF tests, source guard, strict helper TypeScript, Babel, web export, and diff check pass. Active-target denominator semantics remain explicitly unmodified.
- Remediation: validated percentage helper and neutral N/A presentation; local.
- Acceptance: 0/0 and invalid ratios return null; valid 1/2 returns 50%; empty
  report PDF generation succeeds and displays no fabricated percentage. Phase 0.
- Scope caveat: metric denominator semantics for active versus expired targets
  need separate product validation; this fix does not change that formula.

### AN-033 - Worker comparison awards every tied category to Person A

- Category: analytics / comparison scoring; severity HIGH; confidence HIGH.
  Silent.
- Evidence: `components/intelligence/reports/WorkerComparisonReport.tsx` used
  `>=` for higher-is-better metrics and `<=` for lower-is-better revisions,
  making equality count as a Person A win. The majority score also counted each
  category as decisive.
- Risk: identical workers appear to lose to the second-selected person across
  all categories. Desired behavior is ties/invalid values undecided and overall
  winner based only on strictly decided categories.
- Reproduction: identical data gives nine Person A wins with the old `>=`/`<=`
  expressions; source guard was observed failing before helper integration.
- Status: VERIFIED LOCALLY. Tie-aware comparison and tally helpers are covered by unit cases, WorkerComparison integration is guarded, PDF smoke test and web build pass. Visual PDF review remains open.
- Remediation: reuse `compareTeamMetric` and `tallyComparisonWins`; preserve all
  current metrics and better/worse directions. Local fix, Phase 0.
- Acceptance: identical values decide zero categories and have no winner; strict
  higher/lower values retain existing direction; invalid values do not vote.
  PDF renders successfully for identical workers.

### AN-034 - N-person Worker Comparison selects one tied performer and coerces missing rates

- Category: analytics / ranking and null semantics; severity HIGH; confidence
  HIGH for frontend behavior. Silent.
- Parent/root: reoccurrences of AN-030 and AN-031 in `WorkerComparisonReport`.
- Evidence: N-person layout used strict first-winner reduction and
  `Math.max(..., 1)`, and included `(rate || 0)` for on-time/efficiency averages
  and table presentation.
- Risk: tied people appear to have a unique leader; no-observation rates distort
  the average and look like real zero values. Desired behavior matches the
  Personnel report: tied leaders are explicit, actual maxima highlighted, and
  unavailable rates excluded from averages and shown neutrally.
- Reproduction: equal zero points and null rates cause those legacy fallbacks;
  PDF regression case now covers three-person tied-zero + mixed null inputs.
- Status: VERIFIED LOCALLY. Shared ranking/average helpers, source contract, focused tests, and web export pass. Upstream RPC null semantics and PDF visual fit remain open.
- Remediation: reuse shared point-ranking and observed-average helpers. Local fix.
- Acceptance: every maximum is treated as a leader including zero; nullable
  rates are not converted to zero; no-observation group averages show N/A; PDF
  generation succeeds for the edge case.

### AN-035 - Stage Dwell overall mean equally weights stages, not observations

- Category: analytics / aggregation level and weighting; severity HIGH;
  confidence HIGH for current formula and sample-weight expectation. Silent.
- Evidence: `components/intelligence/reports/StageDwellReport.tsx` used the
  arithmetic mean of `avg_seconds` across stages for `Avg Dwell (All)`. The RPC
  `rpc_get_pipeline_stage_dwell` returns a `sample_count` per stage, but the
  overall KPI ignored it. Its stage-level bottleneck baseline is separate and
  intentionally not changed here.
- Risk: sparse stages receive the same weight as high-volume stages. Example:
  stage means 90s with 1 sample and 10s with 9 samples yield old 50s vs
  observation-weighted 18s. No-sample stages were also coerced into zeros.
- Reproduction: helper RED when expected to weight by sample counts; RPC source
  confirms avg_seconds and sample_count fields. `avg_seconds` is rounded to
  bigint, so weighted KPI may differ from exact pooled mean by per-stage rounding.
- Status: VERIFIED LOCALLY. Weighted calculation tests, no-sample PDF smoke, source guard, strict helper TypeScript, Babel, web export, and diff check pass. Exact pooled average differs by rounding from bigint stage means; bottleneck baseline unchanged.
- Remediation: pooled weighted average from stage means and sample counts; show
  N/A for no observations and em dash for stages with zero samples. Local fix.
- Acceptance: 90×1 plus 10×9 gives 18; zero-weight/null observations do not
  affect result; all-zero sample sets produce N/A; sampleless rows render
  unavailable; no change to SQL bottleneck formula. Phase 0 correctness.

### AN-036 - Missing User Summary rates appear as zero performance

- Category: analytics / missing-data semantics; severity HIGH; confidence HIGH
  for frontend coercion, MEDIUM for SQL contract meaning. Silent.
- Evidence: `components/intelligence/reports/UserSummaryReport.tsx` set
  `timer_efficiency` and `on_time_rate` via `|| 0`, rendering absent values as
  measured zero and selecting warning/positive/negative prose from the fake value.
- Risk: unknown measurements can imply poor on-time performance or excellent
  pacing. Desired behavior is preserve valid zero, show N/A/em dash for missing
  rates, neutral colors, and no threshold insights from absent values.
- Reproduction: summary with null rates and no outcomes previously displayed
  `0.0%` for both plus a below-target on-time note; it now stays unavailable.
- Status: VERIFIED LOCALLY. Missing/non-finite values render unavailable with neutral copy/colors, no threshold insight derives from absent rates, and the focused PDF smoke render succeeds.
- Remediation: finite/null normalization, denominator-aware success helper,
  neutral KPI copy/color, and insight guards. Local fix.
- Acceptance: observed 0 remains 0; null/undefined/non-finite rate shows — and
  neutral note/color; no success rate with zero task outcomes; PDF smoke test
  succeeds. Phase 0 correctness.

### AN-037 - Zero-to-zero comparison period is mislabeled as NEW

- Category: analytics presentation / period comparison; severity MEDIUM;
  confidence HIGH for the formatter behavior, MEDIUM for interpreting SQL zero
  outputs. Silent but visible only on a comparison note.
- Evidence: `components/intelligence/reports/GeneralReport.tsx:61` returned
  `NEW` whenever the prior value was falsy; its Throughput, Lead Time, and
  Success Rate cards call this at lines 104-106. The organizational audit SQL
  coalesces empty aggregate values to zero, so zero can represent no observations.
- Risk: two zero-valued periods appear to show newly emerged behavior despite
  identical report values. Desired behavior: state `0 in both periods` without
  claiming a percentage change or new activity.
- Reproduction: `generalReportDelta(0, 0)` previously returned `NEW`.
- Status: VERIFIED LOCALLY. Exported formatter now returns `0 in both periods`
  for zero/zero and preserves existing nonzero-prior percentage calculations
  and zero-to-positive `NEW` behavior. Three focused tests pass.
- Remediation: local pure formatter in GeneralReport; no SQL, denominator, or
  underlying metric semantics changed.
- Acceptance: zero/zero never says `NEW` or a percent; zero-to-positive remains
  `NEW`; nonzero prior retains rounded signed percentage behavior. Phase 0.
- Remaining risk: RPC zero-coalescing means literal zero does not prove that
  observations existed; denominator semantics remain outside this narrow fix.

### AN-038 - General Report productivity leaderboard is ordered by total hours

- Category: analytics / ranking and sorting; severity HIGH; confidence HIGH
  that the implementation uses the wrong ordering, with real-world rank impact
  dependent on worker data. Silent and plausibly convincing.
- Evidence: `supabase/migrations/20260816_fix_organizational_audit_throughput.sql:525-535`
  aggregates `worker_time_metrics` using `ORDER BY wta.total_hours DESC`.
  Before remediation, `GeneralReport.tsx` selected `wtm[0]` for the tasks/hour
  "Top performer" insight and sliced the first eight source-ordered rows for
  the productivity chart. Current locations are `GeneralReport.tsx:48-73`
  (observed ranking and tied insight), `:95,134` (both insight call sites), and
  `:241-244` (sorted chart slice); People Detail remains separately ordered.
- Risk: a high-hours/lower-tasks-per-hour worker may be called top performer,
  while a faster worker with fewer hours can be omitted from the top-eight list.
  Desired behavior: derive ranking order from observed tasks/hour, not the
  upstream time ordering, and keep unrelated detail-table ordering unchanged.
- Reproduction: order rows by hours as the RPC does (A: 40h/20 tasks, B: 5h/10
  tasks); current UI selects A at 0.5 tasks/hour over B at 2 tasks/hour.
- Status: VERIFIED LOCALLY. A stable observed-rate ranking drives the chart and
  top-performer insight; tied top performers are disclosed, invalid hour/task
  observations do not rank, and People Detail retains source order. Focused
  ranking tests and the broader report/build checks pass.
- Remediation: compute one stable client-side productivity ranking from valid
  positive-hour observations; use it for both top-performer insight and chart;
  preserve query order for People Detail. Show all tied top performers neutrally
  rather than invent a unique winner. No SQL/RPC change required.
- Acceptance: adversarial fixture where hours order differs from productivity
  order names/includes the true higher-rate worker; top eight are chosen after
  productivity sorting; zero/missing/non-finite hours do not create a fake
  ranking; tied maxima are disclosed; People Detail order remains unchanged.
  Phase 0 correctness.
- Dependencies: none; source RPC ordering is documented and preserved for
  other consumers.
- Verification: `npm.cmd test -- components/intelligence/reports` (7 files,
  18 tests); `node components/intelligence/ReportGenerationSafety.check.ts`;
  Babel check on GeneralReport and its test; `git diff --check`; serial web
  export; `graphify update .` all pass. Full `npx tsc --noEmit` exits 2 on
  archived Deno/implicit-any diagnostics and has no diagnostics for either
  changed GeneralReport file.
- Remaining risks: no populated business dataset/PDF visual inspection was
  available; upstream worker rows remain ordered by total hours for other
  consumers, and production schema state remains subject to reconciliation.

### AN-039 - Empty organizational-audit periods are rendered as measured zeros

- Category: analytics / null-versus-zero semantics; severity HIGH; confidence
  HIGH in repository SQL/UI behavior, MEDIUM in currently deployed behavior
  because production schema reconciliation is still open. Silent and plausible.
- Evidence: `supabase/migrations/20260816_fix_organizational_audit_throughput.sql:105-153`
  applies `COALESCE(..., 0)` to current and comparison success/revision rates,
  lead time, flow ratio, and first-pass yield where `NULLIF`/empty `AVG` can
  signal no observations. `GeneralReport.tsx:150-152,235-236` converts nullish
  values to zero; 0% success receives danger styling, 0% revision appears green,
  and an empty-period lead time appears as 0 minutes. Insight thresholds also
  default missing values to zero (`:85-88,124-127`). A read-only local catalog
  query confirms both RPCs are owned by `postgres`, `SECURITY DEFINER`, and use
  `search_path=public`; the private implementation has owner-only EXECUTE, and
  the public wrapper grants EXECUTE to `authenticated`. Production equivalence
  is unverified.
- Risk: reports can imply zero-minute completion time, poor quality, or perfect
  no-revision performance when the denominator/sample is empty. Desired behavior
  is N/A for undefined metrics, neutral styling/copy, and threshold insights
  only when the metric has observations; observed 0 remains a real zero.
- Reproduction: an empty `base_tasks` aggregate yields zero-coalesced KPIs from
  the repository SQL; GeneralReport renders numeric zeros and status colors.
- Status: VERIFIED LOCALLY. UI behavior, regression tests, candidate migration,
  and seeded PostgreSQL rollback checks pass against the local Supabase database.
  This is not production verification or deployment approval.
- Remediation: preserve NULL when its metric denominator/sample count is zero in
  the private RPC implementation, propagate nullable values without `|| 0`,
  display N/A neutrally, and guard insight thresholds. Keep the public auth
  wrapper, ACLs, company scope, and output keys stable. Do not edit historical
  migrations or weaken authorization.
- Acceptance: empty current/comparison periods return SQL NULL for undefined
  rates/averages and display N/A; observed zero with positive denominator stays
  0; comparisons with an undefined side show no percentage change; seeded
  current and cross-tenant tests preserve authorization. Phase 0 correctness.
- Dependencies/blockers: forward migration must preserve the existing private
  `SECURITY DEFINER` function's owner, fixed search path, signature, ACLs, and
  tenant/capability checks. Production deployment remains under the separate
  owner-controlled migration reconciliation gate.
- Files added/changed for this package: forward-only
  `supabase/migrations/20260921063116_analytics_audit_empty_sample_semantics.sql`;
  rollback fixture `supabase/checks/check_analytics_audit_empty_sample_semantics.sql`;
  `components/intelligence/reports/GeneralReport.tsx` and its test;
  `lib/analyticsMetrics.ts` and its test; shared trend consumers
  `components/intelligence/RadarWidgets.tsx` and
  `components/intelligence/_graphs_adaptive.tsx`.
- UI verification: focused tests 20/20 across GeneralReport and analytics
  metric helper; combined report/helper suite 30/30 across 8 files; source safety check and Babel pass;
  `npm.cmd run build:web` passes; `git diff --check` passes (with existing
  worktree CRLF warnings). The deleted `Rework ratio` explanation was restored
  and is asserted by regression coverage. A repository-wide call-site search
  found desktop/adaptive trend cards that also coerced nullable RPC values to
  zero; both now use a shared null-aware comparison helper, with observed zero
  preserved and unavailable prior comparisons omitted. Full `npx tsc --noEmit`
  exits 2 on repository diagnostics. A filtered rerun found one existing,
  unrelated nullable `conversion_by_stage` diagnostic at
  `components/intelligence/RadarWidgets.tsx:236`; no diagnostics occur in the
  changed trend-card block, GeneralReport, or `lib/analyticsMetrics`.
- SQL review: candidate migration changes only the private RPC body, preserving
  the public SECURITY DEFINER wrapper, fixed `search_path`, signature/output
  keys, owner/capability/company filters; rollback check asserts empty-vs-zero,
  same/cross-tenant authorization, output keys, wrapper/private ownership,
  SECURITY DEFINER/search path and ACL shape. Check file was strengthened to
  assert the metadata contract directly rather than compare two post-migration
  snapshots. The subsequent local transactional execution passed every fixture
  assertion; see database verification immediately below.
- Database verification: confirmed `supabase_db_TrustFlow` was `running healthy`.
  Reviewed CLI help for `db query`, `migration list/up`, `status`, and `start`;
  no start/reset workflow was invoked. The candidate migration and rollback
  check were streamed together through `docker exec -i ... psql -v
  ON_ERROR_STOP=1` inside one outer `BEGIN`; the check reported
  `ALL CHECKS PASSED`, then its final `ROLLBACK` rolled back both seeded
  fixtures and the temporary function replacement. The check's nested `BEGIN`
  emitted PostgreSQL's expected “already a transaction in progress” warning;
  no error occurred. No migration-history row was written and no lasting
  database changes were made. A first preflight scan had an invalid regex and
  stopped before SQL; the corrected scan/run passed.
- Production remains a separate owner-controlled migration reconciliation,
  rehearsal, backup, and release-approval gate; no production operation ran.
- Graph refresh was attempted after the wider consumer edits; AST extraction
  reached 100%, but graph generation stopped producing output and was
  interrupted, so no refreshed graph artifact is claimed for this package.
- Remaining risks: no PDF visual inspection was performed; graph refresh after
  broader consumer edits remains incomplete. Worker-reported typecheck/web-export
  interruption is superseded by this integration run: web export passed; full
  typecheck remains red on unrelated diagnostics.

| 2026-09-23 | Reporting redesign Tasks A-C integration review | ROOT-001; ROOT-005; AN-039; AN-028..AN-034; UX-001..UX-014; PDF-001..PDF-011; ROOT-006 | PARTIALLY VERIFIED LOCALLY; D/E BLOCKED ON LUNA SPAWN | `lib/reporting/reportContracts.ts`; `lib/reporting/reportContracts.test.ts`; `components/intelligence/ReportReader.tsx`; `components/intelligence/ReportReaderModel.ts`; `components/intelligence/ReportReader.test.tsx`; `components/intelligence/_reports_desktop.tsx`; `components/intelligence/_reports_adaptive.tsx`; `components/intelligence/_ReportGenerator_desktop.tsx`; `components/intelligence/_ReportGenerator_adaptive.tsx`; `components/intelligence/reports/shared.tsx`; `components/intelligence/reports/theme.ts`; `components/intelligence/reports/pdfFixtures.ts`; `components/intelligence/reports/shared.test.tsx`; `components/intelligence/reports/GeneralReport.tsx`; `components/intelligence/reports/GeneralReport.test.tsx`; `components/intelligence/reports/TeamComparisonReport.tsx`; `components/intelligence/reports/WorkerComparisonReport.tsx`; `components/intelligence/reports/PersonnelReport.tsx` | A-C focused integration suite: 7 files/35 tests passes; Babel passes for owned changed TS/TSX; report capability, generation, and timeframe checks pass; `git diff --check` passes. Sol fixed General throughput null-to-zero and invalid chart geometry; focused regressions pass. Full `tsc` is baseline-blocked by unrelated dirty `components/intelligence/_analytics_adaptive.tsx:344`. Browser desktop/mobile manual checks and rasterized/text PDF inspection were not run. The new `PageContext` primitive is not mounted by production report pages, so continuation-page context remains open. | A/B/C are integrated but not complete redesign acceptance. Parent must dispatch D (server snapshot/job/storage) and E (Pro schedules/calendar/notifications) with exclusive ownership. After return, Sol must wire PageContext across report pages, reconcile production/local screenshot behavior, run local SQL/PDF/browser gates, and perform final diff review. |
| 2026-09-23 | D/E advisory review | ROOT-001; ROOT-002; ROOT-005; UX-010; PDF-001..PDF-011; ROOT-006 | OPEN / BLOCKED ON IMPLEMENTATION | None; advisory review only | D confirmed existing auth/lifecycle/RLS/private-bucket contracts but no immutable snapshot/manifest, required-source completeness, or idempotent creation contract. E confirmed calendar is client-side with no durable schedule/marker contract. Docker is running, but Supabase CLI is unavailable and no SQL checks ran. | Re-dispatch D and E as implementation packages when Luna spawn is available; D must add a forward migration/check and E must add durable schedule/marker contracts while preserving existing ACL/company scope and calendar/notification patterns. Production deployment remains separate. |
| 2026-09-23 | D/E returned artifacts reviewed | ROOT-001; ROOT-002; ROOT-005; ROOT-006 | E PURE CONTRACT VERIFIED LOCALLY; D SQL UNVERIFIED/BLOCKED | E: `lib/reporting/reportScheduleContracts.ts`; `lib/reporting/reportScheduleContracts.test.ts`. D artifacts present but not accepted: `supabase/migrations/20260923120000_reporting_snapshot_manifest_contract.sql`; `supabase/checks/check_reporting_snapshot_manifest_contract.sql` | E focused suite: 1 file/6 tests passes, covering cadence/period/DST, Pro/expiry/no-backlog, bounded retry, recipient recheck, protected-link/no attachment, calendar visibility, and occurrence idempotency. D review found patch-context gaps and unverified company-bound scope, runId/snapshotId integrity, artifact/storage policy correctness, and stronger rollback assertions; no SQL check ran because Supabase CLI is unavailable. | Keep D `OPEN/BLOCKED` and do not apply/stage/deploy it. Re-dispatch D for correction and local `docker exec ... psql` transactional verification; re-dispatch E for durable schedule schema/RPC, server occurrence persistence, and existing-calendar marker integration. E pure functions are not a durable schedule implementation. |
| 2026-09-23 | D staged migration runtime review | ROOT-001; ROOT-002; ROOT-005; SEC-012; ROOT-006 | BLOCKED / NOT ACCEPTED | D files were explicitly unstaged after review; files remain untracked and unmodified by Sol | Disposable local execution was attempted with `docker exec -i supabase_db_TrustFlow psql -U postgres -v ON_ERROR_STOP=1`; it failed before D SQL at `ERROR: relation "public.reporting_jobs" does not exist`, confirming the known local bootstrap/schema-lineage blocker. The no-`-U` attempt failed peer authentication for root. No migration state or production DB was changed. Static review also found no callable server wrapper for the revoked private snapshot commit function and incomplete cross-binding of job/run/snapshot/company/artifact access. | D remains `OPEN/BLOCKED`; do not accept or deploy. Requires a corrected migration/check plus a disposable DB with the reporting baseline present, then transactional SQL verification. E may proceed only as pure contract work; durable E remains gated on accepted D. |
| 2026-09-23 | Final Sol integration of reporting redesign tranche | ROOT-001; ROOT-002; ROOT-005; ROOT-006; AN-039; UX-001..UX-014; PDF-001..PDF-011 | PARTIALLY VERIFIED LOCALLY; OVERALL FEATURE INCOMPLETE | A-C report/UI/PDF files plus E pure contracts; D SQL deliberately remains unaccepted, unapplied, and unstaged | Final focused verification: 8 files / 41 tests passed, including A contracts, E schedule contracts, ReportReader, shared PDF, General, Team, Worker, and Personnel regressions. Babel passed for owned changed TS/TSX; report capability/generation/timeframe checks passed; `git diff --check` passed. Full repository typecheck, browser verification, rasterized/text PDF inspection, durable SQL/runtime checks, and production/local reconciliation remain open. | A-C and E pure contract layers are locally verified only. D immutable snapshot/manifest/storage/job contract remains blocked by missing local `public.reporting_jobs`, absent safe callable server wrapper, and incomplete identity/storage binding. Durable scheduling/calendar persistence remains blocked; no production deployment or migration application occurred. |
| 2026-09-23 | Local bootstrap/source diagnosis and browser feasibility | ROOT-002; ROOT-004; ROOT-006; UX-001..UX-014 | VERIFIED OBSERVATION; OWNER ACTION REQUIRED | Read-only inspection: `supabase/migrations/20260510_reports_engine_v2.sql:24-37`; no schema changes | Repository source of `public.reporting_jobs` is `20260510_reports_engine_v2.sql`, which creates the table after `public.companies`/`public.users` dependencies. Local DB query shows `to_regclass('public.reporting_jobs')`, `companies`, and `users` all NULL; `supabase_migrations.schema_migrations` has 0 rows; only Supabase service schemas are present. This proves the local instance is empty/unhydrated, not that D fabricated the table. `npx.cmd supabase --version` is 2.110.0 and help was inspected. Existing web server on port 8081 returned HTTP 200; a new Expo server was not started because the port was occupied, and CUA/browser automation failed to initialize, so responsive visual verification was not performed. | Owner must provide a disposable DB hydrated from the repository’s complete baseline migration chain or approved schema dump, with migration lineage recorded; do not use reset/production deployment as a shortcut. Then rerun D SQL transaction/check. Browser verification requires a functioning browser automation surface or manual review of the existing 8081 server. |
| 2026-09-23 | Disposable baseline hydration attempt | ROOT-002; ROOT-005; ROOT-006 | VERIFIED BLOCKER; D NOT ACCEPTED | Disposable target `trustflow_reporting_baseline_audit_20260923` on `localhost:55432`; no repository files changed by hydration | Target was independently verified as PostgreSQL 17.11 and isolated from `supabase_db_TrustFlow`. Ordered replay of repository migrations was attempted only against this disposable target. The first migration, `20260430_final_bunker_timer.sql`, failed before schema hydration with `ERROR: schema "auth" does not exist` at its `auth.uid()`/`auth.users` dependency. The target still has no `public.reporting_jobs`, `public.tasks`, `public.companies`, or `public.users`. No current local DB or production DB was reset, overwritten, or deployed. Repository inspection found no approved baseline schema dump; `supabase/seed.sql` contains data-only `pg_dump` output and `supabase/seed-auth-users.sql` is missing. | Provide an approved disposable baseline restore/schema dump or the complete initial Supabase schema lineage including Auth/storage prerequisites. Do not fabricate `auth`, `companies`, `users`, or `reporting_jobs` just to make D pass. After hydration, re-dispatch D correction and run the migration/check inside an outer transaction with final rollback. Durable E remains gated on accepted D. |

| 2026-09-23 | Post-hydration integration gates | ROOT-001; ROOT-005; ROOT-006; PDF-001..PDF-011 | VERIFIED LOCALLY FOR A-C/E PURE CONTRACTS; D/E DURABLE BLOCKED | `components/intelligence/reports/shared.tsx`; `docs/REPORTING_REMEDIATION_LEDGER.md`; D artifacts remain unaccepted/unapplied/unstaged | Focused regression suite passed: 8 files / 41 tests. Babel checks passed for all owned A-C/E TS/TSX files. Report capability, generation-safety, and timeframe checks passed. Targeted `git diff --check` passed with only existing CRLF normalization warnings. No browser automation or rasterized/text PDF inspection is claimed: CUA could not initialize and Playwright is not installed; existing web-server HTTP 200 is only a transport smoke check. Disposable container was stopped after evidence capture. | Keep D migration/check unstaged and unaccepted until an approved baseline is hydrated; then run D correction and transactional rollback verification. Durable E scheduling/calendar persistence follows only after D acceptance. |

## Product decision gates

| Decision | Blocks | Safe interim behavior |
|---|---|---|
| Event throughput versus created-task cohort throughput | AN-009, AN-010 | Keep existing formula but rename/disclose; do not call it generic success quality |
| Shared-task team attribution | AN-007, AN-022 | Do not introduce a new winner score; disclose overlap |
| Company versus requester report timezone | AN-004, AN-019 | Persist and display requester IANA timezone; use half-open intervals |
| Salary/cost reporting policy | SEC-007, AN-014 | Do not persist salary values; omit cost when no approved rate source exists |
| Renderer infrastructure | PDF-001..PDF-011 | Keep current renderer only as an interim adapter after server ownership |
