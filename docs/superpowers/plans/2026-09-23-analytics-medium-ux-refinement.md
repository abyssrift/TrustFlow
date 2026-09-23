# Analytics Medium UX Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace dense Analytics controls with established accessible patterns and simplify Targets copy without changing product semantics.

**Architecture:** Reuse `SearchableMultiSelect` in each Personnel screen, add platform-appropriate accessibility metadata to existing controls, and keep all data, request, persistence, permission, and mutation paths intact. Desktop Analytics, adaptive Analytics, and Targets are disjoint implementation packages.

**Tech Stack:** React Native, React Native Web, NativeWind, Expo Router, Vitest, repository Babel check.

## Global Constraints

- Preserve metric formulas, request state, permissions, billing gates, AsyncStorage keys, and target mutations.
- Reuse `SearchableMultiSelect`; do not create a parallel picker.
- Keep `Popup` for target dialogs.
- Use 44px minimum interactive targets and semantic theme tokens.
- Do not add team grouping because the current roster query has no team field.
- Preserve unrelated dirty work.

---

### Task 1: Desktop Personnel picker

**Files:**
- Modify: `components/intelligence/_analytics_desktop.tsx`

**Interfaces:**
- Consumes: `SearchableMultiSelect`, existing `users`, `selected`, and `toggleUser` state.
- Produces: the same selected user IDs consumed by salary and comparison logic.

- [x] Replace the search field, All/None controls, and pill wall with `SearchableMultiSelect` in flat mode.
- [x] Map users to `{ id, label, avatarUrl }`, pass selected items, and preserve clear/select behavior.
- [x] Replace scoped `text-white` button text with `text-brand-on-primary`; add missing 44px labels to adjacent cohort actions.
- [x] Run the shared picker check, targeted Babel, and scoped diff check.

### Task 2: Adaptive Analytics semantics and picker

**Files:**
- Modify: `components/intelligence/_analytics_adaptive.tsx`

**Interfaces:**
- Consumes: the same `SearchableMultiSelect` contract and existing tab state.
- Produces: unchanged selected user IDs and `AdminTab` values.

- [x] Replace the search field and pill wall with the shared picker in flat mode.
- [x] Mark the switcher as a tab list; mark each control as a tab with selected and disabled state and a 44px target.
- [x] Normalize cohort chips and primary action text to semantic theme tokens; replace raw placeholder color.
- [x] Preserve billing and permission behavior and run targeted Babel plus scoped diff check.

### Task 3: Target dialog accessibility, semantic color, and copy

**Files:**
- Modify: `components/intelligence/_targets_desktop.tsx`
- Modify: `components/intelligence/_targets_adaptive.tsx`

**Interfaces:**
- Consumes: existing `Popup`, target screen adapters, and update handlers.
- Produces: unchanged mutation payloads and dialog callbacks.

- [x] Give dialog close, cancel, and save controls explicit roles, labels, disabled state, and 44px sizing.
- [x] Replace scoped `text-white` with `text-brand-on-primary`.
- [x] Apply the approved plain target labels while preserving stored types and fields.
- [x] Run focused target presentation tests, targeted Babel, and scoped diff check.

### Task 4: Integration verification

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-analytics-medium-ux-refinement.md`

- [x] Review selection and target mutation data paths for behavioral drift.
- [x] Run focused checks and tests for shared picker and target presentation contracts.
- [x] Run Babel parsing for all four changed screens and scoped `git diff --check`.
- [x] Record verification performed and leave browser or device walkthrough unchecked if unavailable.

## Verification record

- 2026-09-23: `SearchableMultiSelect.check.ts` passed.
- 2026-09-23: target presentation Vitest passed (1 file, 2 tests).
- 2026-09-23: repository Babel parsing passed for all four changed screens.
- 2026-09-23: `Block.check.ts`, semantic-token/source contract scan, and scoped `git diff --check` passed.
- Browser and device walkthroughs were not run.
