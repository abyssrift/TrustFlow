# Overview Request State Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop and adaptive Overview show only current-scope audit data with truthful loading, updating, empty, and error states.

**Architecture:** Each renderer keeps a keyed audit snapshot and monotonic request generation. Desktop keys pipeline plus explicit range; adaptive keys radar section, pipeline, and days. Only the newest generation for the current key may commit, while unrelated Target Watch and Project Lens readers remain independent.

**Tech Stack:** React Native / React Native Web, TypeScript, existing Analytics context and Overview components.

## Constraints

- Modify only `components/intelligence/_index_desktop.tsx` and `components/intelligence/_index_adaptive.tsx` audit state paths.
- No SQL, metric, layout, navigation, archives/report, TargetWatch, or ProjectLens changes.
- Exact Error copy: `Couldn’t load overview.` with one accessible 44px `Retry` button.
- Preserve measured zero; Empty only follows a successful null/empty audit result.
- Permission and billing branches retain priority. Adaptive archive/report loading stays separate.
- Do not add/run tests until the authorized final verification phase.

### Task 1: Desktop Overview audit state

**Ownership:** `components/intelligence/_index_desktop.tsx` only.

- [x] Add desktop request key `JSON.stringify([pipelineId, from, to, days])`, current-key ref, monotonic generation, state key, and accepted snapshot key.
- [x] Replace the loose `loading/data` fetch with keyed Loading/Updating/Ready/Empty/Error transitions; discard stale A-to-B-to-A completions.
- [x] Stop rendering old-key audit values immediately on filter changes. Keep same-key snapshot visible while explicitly refreshing.
- [x] Render exact Error + accessible Retry and preserve existing successful empty treatment.
- [x] Keep permission/billing states, AtAGlance, TargetWatch, ProjectLens, filters, and layout unchanged. Diff-check only.

### Task 2: Adaptive Overview audit state

**Ownership:** `components/intelligence/_index_adaptive.tsx` only.

- [x] Add adaptive request key `JSON.stringify([activeSection, pipelineId, days])`, generation, state key, and keyed snapshot.
- [x] Settle first-load errors as Error rather than leaving `RadarSection` spinning; reject stale success/failure completions.
- [x] Bind `RefreshControl.refreshing` to current-key Updating and use the keyed loader for refresh/retry.
- [x] Render exact Error + accessible Retry and successful Empty without affecting archives/report loading.
- [x] Preserve section routing, permission behavior, TargetWatch, ProjectLens, layout, and unrelated flows. Diff-check only.

### Task 3: Sol review

- [x] Compare state transitions, request keys, generations, copy, empty/error distinctions, and adaptive refresh behavior.
- [x] Confirm only the two Overview files changed for this implementation and dirty work was preserved.
- [x] Run scoped source diff checks; defer runtime widths and forced races to final verification.

## Final walkthrough

- ~1400 px: gates, first load, ready, empty, error, Retry, same-key refresh.
- ~1000 px: rapid pipeline/range changes and out-of-order responses.
- 390 px: first failure, Retry, real pull-to-refresh state, and no overflow.
