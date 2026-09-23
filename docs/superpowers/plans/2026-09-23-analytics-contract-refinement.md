# Analytics Contract Refinement Plan

**Goal:** Remove the remaining false-zero and legacy target contract paths without introducing new metric definitions or changing SQL.

## Invariants

- A bucket with no succeeded or failed tasks has `success_rate: null`.
- A bucket with observations may report a real `0%`; that zero remains visible.
- A missing throughput value renders unavailable and never participates in a delta.
- Shared TypeScript contracts admit the nullable values already supported by runtime formatting.
- Canonical analytics targets remain the only target progress/status reader used by Intelligence UI.

## Work packages

- [x] Update `hooks/usePipelineOverviewData.ts` and add focused pure coverage for null versus measured-zero success rates.
- [x] Update `components/intelligence/IntelligenceSections.tsx` so throughput KPI values and deltas preserve unavailable versus zero; add focused coverage through an exported pure mapper if needed.
- [x] Align `lib/analyticsMetrics.ts` and `lib/analyticsMetrics.test.ts` throughput nullability and formatting coverage.
- [x] Remove the unused `TargetsMiniWeb` and legacy `getTargetsStatus`/`TargetStatus` Intelligence UI contract after confirming no remaining imports or calls.
- [x] Run focused tests, targeted Babel parsing, source checks, and scoped diff review.

## Non-goals

- No automation, flow-ratio, first-pass, on-time, rework, or lead-time definition changes.
- No SQL migrations, route changes, visual redesign, or target mutation changes.
- No changes to report payload compatibility unless a current call site requires them.

## Acceptance

- Missing and measured-zero analytics are distinguishable in types, pure mapping, and UI.
- No Intelligence UI can call `rpc_get_targets_status`; canonical target screens and Target Watch remain unchanged.
- Focused checks pass and no unrelated dirty work is overwritten.

## Completion note

Completed 2026-09-23. Native pipeline overview rendering was included in the nullability integration review: unavailable values create gaps rather than false zero points, while measured zero remains plotted and the latest-value legend uses an em dash. The combined focused suite passes 16/16, all seven scoped source files pass Babel parsing, `Block.check.ts` passes, the legacy Intelligence target symbols are absent, and the scoped diff check is clean. `components/intelligence/reports/generate.ts` still calls the legacy target-status RPC for report payload compatibility; it is outside the Intelligence UI reader contract and was intentionally left unchanged.
