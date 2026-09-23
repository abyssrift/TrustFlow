# Analytics UI Hardening Implementation Plan

**Goal:** Implement the approved UI hardening design while preserving existing metric and authorization semantics.

## Work packages

- [x] Desktop Analytics and Performance: independent settled series, local error/empty presentation, plain scope copy, normalized strings, named 44px controls.
- [x] Adaptive Analytics and Performance: desktop-equivalent series behavior, normalized strings, named 44px controls, reduced density, semantic theme colors.
- [x] Desktop/adaptive Targets and Target Watch: valid-progress-only rings, compact unavailable/performance cards, normalized strings, 44px named controls.
- [x] Add focused pure/source checks for activity classification, partial failures, valid-progress-only target presentation, and accessibility/copy invariants.
- [x] Run focused tests, targeted Babel, relevant source checks, and scoped diff review.

## Verification record

- 2026-09-23: focused Vitest contracts passed (2 files, 6 tests).
- 2026-09-23: targeted Babel parsing passed for all nine changed source files.
- 2026-09-23: `Block.check.ts`, scoped mojibake scan, and scoped `git diff --check` passed.
- Browser and device walkthroughs were not run in this package.

## Integration order

1. Integrate desktop and adaptive request-state packages and compare state semantics.
2. Integrate target presentation independently.
3. Normalize remaining scoped strings and theme colors without crossing file ownership.
4. Run combined verification once all packages are present.

## Constraints

- Preserve request keys and monotonic generation guards.
- Preserve plan gates, permission gates, date controls, and canonical target adapter.
- Preserve measured zero separately from null/unavailable.
- Do not touch SQL or introduce new metric calculations.
- Preserve unrelated dirty work.
